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

  // Success view if submitted by Admin
  if (adminSubmitResult) {
    return (
      <div
        dir="rtl"
        style={{
          minHeight: '85vh',
          backgroundColor: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
        }}
      >
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            padding: '36px 28px',
            maxWidth: '560px',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: '#ecfdf5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <CheckCircleIcon size={36} color="#10b981" />
          </div>

          <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>
            {adminSubmitResult.dispatched
              ? t('delivery_reps.driver_new_load_requisition_view.s0', "تم صرف البضاعة وتحميل السيارة وبدء رحلة التوزيع!")
              : t('delivery_reps.driver_new_load_requisition_view.s1', "تم حفظ إذن التحميل كمسودة معلقة بنجاح!")}
          </h2>

          <div
            style={{
              backgroundColor: '#f1f5f9',
              borderRadius: '8px',
              padding: '12px 18px',
              margin: '14px 0 20px',
              display: 'inline-flex',
              gap: '20px',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div>
              <span style={{ fontSize: '11.5px', color: '#64748b', display: 'block' }}>{t('delivery_reps.driver_new_load_requisition_view.s2', "رقم إذن التحميل:")}</span>
              <span style={{ fontSize: '17px', fontWeight: 900, color: '#170e5e', fontFamily: 'monospace' }}>
                #{adminSubmitResult.docNo}
              </span>
            </div>
            {adminSubmitResult.tripId && (
              <>
                <div style={{ height: '28px', width: '1px', backgroundColor: '#cbd5e1' }} />
                <div>
                  <span style={{ fontSize: '11.5px', color: '#64748b', display: 'block' }}>{t('delivery_reps.driver_new_load_requisition_view.s3', "رقم رحلة التوزيع:")}</span>
                  <span style={{ fontSize: '17px', fontWeight: 900, color: '#15803d', fontFamily: 'monospace' }}>
                    #{adminSubmitResult.tripId}
                  </span>
                </div>
              </>
            )}
          </div>

          <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.6, margin: '0 0 24px' }}>
            {adminSubmitResult.dispatched
              ? `تم خصم كميات البضاعة من المستودع وتحويلها لعهدة سيارة المندوب "${adminSubmitResult.repName}". السيارة محملة والرحلة نشطة.`
              : `تم تسجيل طلب التحميل وإسناده للمندوب "${adminSubmitResult.repName}".`}
          </p>

          <Button
            variant="primary"
            onClick={onBack}
            style={{
              backgroundColor: '#170e5e',
              color: '#ffffff',
              fontSize: '13.5px',
              fontWeight: 800,
              padding: '10px 24px',
              width: '100%',
              borderRadius: '10px',
            }}
          >
            {t('delivery_reps.driver_new_load_requisition_view.s4', "العودة لقائمة أذونات التحميل")}
          </Button>
        </div>
      </div>
    );
  }

  // Success view if submitted in driver mode
  if (submittedDocNo) {
    return (
      <div
        dir="rtl"
        style={{
          minHeight: '85vh',
          backgroundColor: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
        }}
      >
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            padding: '36px 28px',
            maxWidth: '520px',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: '#ecfdf5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <CheckCircleIcon size={36} color="#10b981" />
          </div>

          <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>
            {t('delivery_reps.driver_new_load_requisition_view.s5', "تم إرسال طلب شحن البضاعة بنجاح!")}
          </h2>

          <div
            style={{
              backgroundColor: '#f1f5f9',
              borderRadius: '8px',
              padding: '10px 14px',
              margin: '14px 0 20px',
              display: 'inline-block',
            }}
          >
            <span style={{ fontSize: '12px', color: '#64748b', display: 'block' }}>{t('delivery_reps.driver_new_load_requisition_view.s6', "رقم إذن التحميل المقترح:")}</span>
            <span style={{ fontSize: '18px', fontWeight: 900, color: '#170e5e', fontFamily: 'monospace' }}>
              #{submittedDocNo}
            </span>
          </div>

          <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.6, margin: '0 0 24px' }}>
            {t('delivery_reps.driver_new_load_requisition_view.s7', "تم رفع الطلب إلى المشرف المختص لمراجعة الأرصدة وإصدار أمر الصرف الفعلي لسيارتك.")}
          </p>

          <Button
            variant="primary"
            onClick={onBack}
            style={{
              backgroundColor: '#170e5e',
              color: '#ffffff',
              fontSize: '13.5px',
              fontWeight: 800,
              padding: '10px 24px',
              width: '100%',
              borderRadius: '10px',
            }}
          >
            {t('delivery_reps.driver_new_load_requisition_view.s8', "العودة للرئيسية")}
          </Button>
        </div>
      </div>
    );
  }

  function renderProductsList(items: DriverAvailableProduct[]) {
    if (items.length === 0) {
      return (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            padding: '30px 14px',
            textAlign: 'center',
            color: '#64748b',
            fontSize: '12px',
          }}
        >
          <span>{t('delivery_reps.driver_new_load_requisition_view.s9', "لا توجد أصناف متوفرة حالياً بالبحث أو القسم المحدد بالمخزن.")}</span>
          {outOfStockCount > 0 && !showOutOfStock && (
            <div style={{ marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setShowOutOfStock(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#170e5e',
                  fontWeight: 700,
                  fontSize: '12px',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                {t('delivery_reps.driver_new_load_requisition_view.s10', "عرض الأصناف غير المتوفرة (")}{outOfStockCount})
              </button>
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: '8px',
        }}
      >
        {items.map((prod) => {
          const isOutOfStock = prod.totalStock <= 0;
          const mult = prod.packagingUnit?.multiplier || 1;
          const isCartonItem = Boolean(prod.packagingUnit && mult > 1);

          // Current chosen quantity in lines
          const lineItem = lines.find((l) => Number(l.productId) === prod.id);
          const totalChosen = lineItem ? lineItem.qty : 0;
          const currentCartons = lineItem?.cartons ?? (isCartonItem ? Math.floor(totalChosen / mult) : 0);
          const currentPieces = lineItem?.pieces ?? (isCartonItem ? totalChosen % mult : totalChosen);

          // Stock breakdown in cartons
          const availCartons = isCartonItem ? Math.floor(prod.totalStock / mult) : 0;
          const availPieces = isCartonItem ? prod.totalStock % mult : prod.totalStock;

          return (
            <div
              key={prod.id}
              style={{
                border: `1px solid ${totalChosen > 0 ? '#c7d2fe' : '#e2e8f0'}`,
                borderRadius: '9px',
                padding: '8px 10px',
                backgroundColor: totalChosen > 0 ? '#f5f3ff' : isOutOfStock ? '#f8fafc' : '#ffffff',
                opacity: isOutOfStock && totalChosen === 0 ? 0.65 : 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                transition: 'border-color 0.15s ease',
              }}
            >
              {/* Row 1: Name & Badges */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                <span style={{ fontWeight: 800, fontSize: '12.5px', color: '#0f172a', lineHeight: 1.3 }}>
                  {prod.name}
                </span>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    backgroundColor: '#eef2ff',
                    color: '#3730a3',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {prod.supplierName || t('delivery_reps.driver_new_load_requisition_view.s11', "الشركة العامة")}
                </span>
              </div>

              {/* Row 2: Price, FEFO Expiry & Warehouse Stock */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', flexWrap: 'wrap', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ color: '#170e5e', fontWeight: 800 }}>
                    {t('delivery_reps.driver_new_load_requisition_view.s12', "سعر:")} {prod.retailPrice.toFixed(2)} <CurrencySymbol />
                  </span>
                  {prod.expiryStatus === 'expired' && (
                    <span style={{ fontSize: '9.5px', backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', padding: '1px 5px', borderRadius: '4px', fontWeight: 800 }}>
                      {t('delivery_reps.driver_new_load_requisition_view.s13', "منتهي الصلاحية (")}{prod.earliestExpiryDate})
                    </span>
                  )}
                  {prod.expiryStatus === 'near_expiry' && (
                    <span style={{ fontSize: '9.5px', backgroundColor: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', padding: '1px 5px', borderRadius: '4px', fontWeight: 800 }}>
                      {t('delivery_reps.driver_new_load_requisition_view.s14', "FEFO قريب الانتهاء (")}{prod.daysToExpiry} {t('delivery_reps.driver_new_load_requisition_view.s15', "يوم)")}
                    </span>
                  )}
                  {prod.expiryStatus === 'valid' && prod.earliestExpiryDate && (
                    <span style={{ fontSize: '9.5px', backgroundColor: '#f1f5f9', color: '#475569', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                      {t('delivery_reps.driver_new_load_requisition_view.s16', "صلاحية:")} {prod.earliestExpiryDate}
                    </span>
                  )}
                </div>

                <span
                  style={{
                    fontWeight: 700,
                    color: !isOutOfStock ? '#15803d' : '#dc2626',
                    backgroundColor: !isOutOfStock ? '#ecfdf5' : '#fef2f2',
                    border: `1px solid ${!isOutOfStock ? '#bbf7d0' : '#fecaca'}`,
                    padding: '1px 6px',
                    borderRadius: '5px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {!isOutOfStock ? (
                    isCartonItem ? (
                      <>
                        {availCartons} {prod.packagingUnit?.name} {availPieces > 0 ? `+ ${availPieces}ق` : ''} ({prod.totalStock}{t('delivery_reps.driver_new_load_requisition_view.s17', "ق)")}
                      </>
                    ) : (
                      `متاح: ${prod.totalStock} ${prod.unit}`
                    )
                  ) : (
                    t('delivery_reps.driver_new_load_requisition_view.s18', "نافد من المخزن")
                  )}
                </span>
              </div>

              {/* Row 3: Action / Steppers */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '2px', borderTop: '1px solid #f1f5f9', paddingTop: '4px' }}>
                {totalChosen === 0 ? (
                  isCartonItem ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                      <button
                        type="button"
                        onClick={() => handleUpdateProductUnits(prod, 1, 0)}
                        disabled={isOutOfStock}
                        style={{
                          flex: 1,
                          backgroundColor: !isOutOfStock ? '#170e5e' : '#f1f5f9',
                          color: !isOutOfStock ? '#ffffff' : '#94a3b8',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '5px 8px',
                          fontSize: '11px',
                          fontWeight: 800,
                          cursor: !isOutOfStock ? 'pointer' : 'not-allowed',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          height: '28px',
                        }}
                      >
                        <PlusIcon size={12} />
                        <span>{t('delivery_reps.driver_new_load_requisition_view.s19', "+ حجز")} {prod.packagingUnit?.name || t('delivery_reps.driver_new_load_requisition_view.s20', "كرتونة")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateProductUnits(prod, 0, 1)}
                        disabled={isOutOfStock}
                        style={{
                          backgroundColor: '#f8fafc',
                          color: '#334155',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          padding: '5px 8px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: !isOutOfStock ? 'pointer' : 'not-allowed',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '3px',
                          height: '28px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <PlusIcon size={11} color="#64748b" />
                        <span>{t('delivery_reps.driver_new_load_requisition_view.s21', "+ بالقطعة")}</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleCatalogAdd(prod)}
                      disabled={isOutOfStock}
                      style={{
                        backgroundColor: !isOutOfStock ? '#170e5e' : '#f1f5f9',
                        color: !isOutOfStock ? '#ffffff' : '#94a3b8',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '5px 12px',
                        fontSize: '11.5px',
                        fontWeight: 800,
                        cursor: !isOutOfStock ? 'pointer' : 'not-allowed',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        height: '28px',
                        width: '100%',
                      }}
                    >
                      <PlusIcon size={12} />
                      <span>{t('delivery_reps.driver_new_load_requisition_view.s22', "إضافة للتحميل")}</span>
                    </button>
                  )
                ) : isCartonItem ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#170e5e' }}>
                      {t('delivery_reps.driver_new_load_requisition_view.s23', "المطلوب:")} {totalChosen} {t('delivery_reps.driver_new_load_requisition_view.s24', "قطعة")}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <CompactStepper
                        value={currentCartons}
                        unitLabel={prod.packagingUnit?.name || t('delivery_reps.driver_new_load_requisition_view.s25', "كرتونة")}
                        onIncrement={() => handleCartonIncrement(prod, currentCartons, currentPieces)}
                        onDecrement={() => handleCartonDecrement(prod, currentCartons, currentPieces)}
                        onChange={(val) => handleUpdateProductUnits(prod, val, currentPieces)}
                        disabledDecrement={currentCartons <= 0}
                        height="28px"
                        inputWidth="32px"
                      />
                      <span style={{ fontWeight: 800, color: '#94a3b8', fontSize: '11px' }}>+</span>
                      <CompactStepper
                        value={currentPieces}
                        unitLabel={t('delivery_reps.driver_new_load_requisition_view.s26', "قطع")}
                        onIncrement={() => handlePieceIncrement(prod, currentCartons, currentPieces)}
                        onDecrement={() => handlePieceDecrement(prod, currentCartons, currentPieces)}
                        onChange={(val) => handleUpdateProductUnits(prod, currentCartons, val)}
                        disabledDecrement={currentPieces <= 0}
                        height="28px"
                        inputWidth="32px"
                      />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#170e5e' }}>
                      {t('delivery_reps.driver_new_load_requisition_view.s27', "القيمة:")} {(totalChosen * prod.retailPrice).toFixed(2)} <CurrencySymbol />
                    </span>
                    <CompactStepper
                      value={totalChosen}
                      unitLabel={prod.unit || t('delivery_reps.driver_new_load_requisition_view.s28', "قطعة")}
                      isDecimal={Boolean(prod.isWeight)}
                      step={prod.isWeight ? 0.5 : 1}
                      min={0}
                      onIncrement={() => handleSingleIncrement(prod, totalChosen)}
                      onDecrement={() => handleSingleDecrement(prod, totalChosen)}
                      onChange={(val) => handleUpdateProductUnits(prod, 0, val)}
                      disabledDecrement={totalChosen <= 0}
                      height="28px"
                      inputWidth={prod.isWeight ? '44px' : '36px'}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
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
        {/* Top Header Bar */}
        <header
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            padding: '8px 12px',
            marginBottom: '8px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <button
              type="button"
              onClick={handleGoBack}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '7px',
                backgroundColor: '#f1f5f9',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#475569',
                flexShrink: 0,
              }}
              title={t('delivery_reps.driver_new_load_requisition_view.s29', "العودة للقائمة")}
            >
              <ArrowRightIcon size={16} />
            </button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontSize: isMobile ? '13px' : '14px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {isAdmin ? t('delivery_reps.driver_new_load_requisition_view.s30', "إسناد وصرف إذن تحميل السيارة") : t('delivery_reps.driver_new_load_requisition_view.s31', "طلب شحن وتحميل سيارة التوزيع")}
                </h1>
                <span
                  style={{
                    backgroundColor: isAdmin ? '#fef3c7' : '#e0e7ff',
                    color: isAdmin ? '#92400e' : '#3730a3',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '5px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {isAdmin ? t('delivery_reps.driver_new_load_requisition_view.s32', "إسناد إداري") : t('delivery_reps.driver_new_load_requisition_view.s33', "مسودة جديدة")}
                </span>
                {isMobile && distinctItemsCount > 0 && (
                  <span
                    style={{
                      backgroundColor: '#f0fdf4',
                      color: '#15803d',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: '5px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    ({distinctItemsCount} {t('delivery_reps.driver_new_load_requisition_view.s34', "بالطلب)")}
                  </span>
                )}
              </div>
            </div>
          </div>

          {!isMobile && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
              {isAdmin ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => handleAdminSubmit(true)}
                  disabled={isSubmitting || validLines.length === 0}
                  style={{
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 800,
                    padding: '6px 12px',
                    whiteSpace: 'nowrap',
                    height: '32px',
                  }}
                >
                  {adminSubmitMutation.isPending ? t('delivery_reps.driver_new_load_requisition_view.s35', "جاري الصرف...") : `صرف وتحميل (${distinctItemsCount})`}
                </Button>
              ) : pendingRequisition ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleCancelPendingAndRestore}
                  disabled={isCancellingRequisition}
                  style={{
                    backgroundColor: '#b45309',
                    color: '#ffffff',
                    fontSize: '11.5px',
                    fontWeight: 800,
                    padding: '6px 12px',
                    whiteSpace: 'nowrap',
                    height: '32px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  title={`لديك طلب معلق #${pendingRequisition.docNo} - انقر لإلغائه وتعديل أصنافه`}
                >
                  <RefreshCwIcon size={12} />
                  {isCancellingRequisition ? t('delivery_reps.driver_new_load_requisition_view.s36', "جاري الإلغاء...") : t('delivery_reps.driver_new_load_requisition_view.s37', "إلغاء المعلق وتعديل الأصناف")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleSubmit}
                  disabled={isSubmitting || validLines.length === 0}
                  style={{
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 800,
                    padding: '6px 12px',
                    whiteSpace: 'nowrap',
                    height: '32px',
                  }}
                >
                  {isSubmitting ? t('delivery_reps.driver_new_load_requisition_view.s38', "جارٍ الإرسال...") : `إرسال للمشرف (${distinctItemsCount})`}
                </Button>
              )}
            </div>
          )}
        </header>

        {/* Pending Requisition Warning & Recovery Banner */}
        {pendingRequisition && !isAdmin && (
          <div
            style={{
              marginBottom: '10px',
              padding: '12px 14px',
              backgroundColor: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '10px',
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'stretch' : 'center',
              justifyContent: 'space-between',
              gap: '10px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <div
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '8px',
                  backgroundColor: '#fef3c7',
                  border: '1px solid #fde68a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <ClockIcon size={18} color="#b45309" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 800, color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{t('delivery_reps.driver_new_load_requisition_view.s39', "طلب إذن تحميل معلق برقم #")}{pendingRequisition.docNo}</span>
                  <span style={{ fontSize: '10.5px', padding: '1px 6px', borderRadius: '4px', backgroundColor: '#fef3c7', color: '#b45309', fontWeight: 700 }}>
                    {t('delivery_reps.driver_new_load_requisition_view.s40', "قيد انتظار مراجعة المشرف")}
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#78350f', marginTop: '3px' }}>
                  {t('delivery_reps.driver_new_load_requisition_view.s41', "المستودع:")} <strong>{pendingRequisition.sourceWarehouseName || t('delivery_reps.driver_new_load_requisition_view.s42', "المستودع الرئيسي")}</strong> {t('delivery_reps.driver_new_load_requisition_view.s43', "| الأصناف:")} <strong>{pendingRequisition.requestedItems?.length || 0} {t('delivery_reps.driver_new_load_requisition_view.s44', "صنف")}</strong>{t('delivery_reps.driver_new_load_requisition_view.s45', ". لمنع تكرار الطلبات، يلزم إلغاء الطلب المعلق أولاً لتعديل كمياته أو انتظار اعتماده وصرفه.")}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <Button
                type="button"
                variant="primary"
                onClick={handleCancelPendingAndRestore}
                disabled={isCancellingRequisition}
                style={{
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: 800,
                  padding: '7px 14px',
                  borderRadius: '8px',
                  whiteSpace: 'nowrap',
                  height: '34px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <RefreshCwIcon size={13} />
                {isCancellingRequisition ? t('delivery_reps.driver_new_load_requisition_view.s46', "جاري الإلغاء...") : t('delivery_reps.driver_new_load_requisition_view.s47', "إلغاء الطلب المعلق وتعديل الأصناف")}
              </Button>
            </div>
          </div>
        )}

        {/* Draft Restored Banner */}
        {isDraftRestored && (
          <div
            style={{
              marginBottom: '8px',
              padding: '8px 12px',
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              fontSize: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#1e40af' }}>
              <CheckCircleIcon size={15} />
              <span>
                <strong>{t('delivery_reps.driver_new_load_requisition_view.s48', "تم استرجاع المسودة تلقائياً:")}</strong> ({validLines.length} {t('delivery_reps.driver_new_load_requisition_view.s49', "صنف محفوظ).")}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleClearDraft}
                style={{
                  fontSize: '11px',
                  color: '#b91c1c',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 700,
                  textDecoration: 'underline',
                  padding: '2px 4px',
                }}
              >
                {t('delivery_reps.driver_new_load_requisition_view.s50', "حذف")}
              </button>
              <button
                type="button"
                onClick={dismissRestoredNotice}
                style={{
                  fontSize: '11px',
                  color: '#1e40af',
                  backgroundColor: '#dbeafe',
                  border: '1px solid #bfdbfe',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  padding: '2px 8px',
                }}
              >
                {t('delivery_reps.driver_new_load_requisition_view.s51', "إغلاق")}
              </button>
            </div>
          </div>
        )}

        {/* Basic Info Section (Source Warehouse & Representative) */}
        <section
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #cbd5e1',
            padding: '8px 12px',
            marginBottom: '8px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '6px',
              paddingBottom: '4px',
              borderBottom: '1px solid #f1f5f9',
            }}
          >
            <div style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px' }} />
            <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
              {t('delivery_reps.driver_new_load_requisition_view.s52', "المعلومات الأساسية لطلب التحميل")}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '2px' }}>
                {t('delivery_reps.driver_new_load_requisition_view.s53', "من مخزن (مستودع الصرف)")}
              </label>
              <CustomSelect
                value={selectedWarehouseFilter}
                onChange={(val) => setSelectedWarehouseFilter(val)}
                options={warehouseSelectOptions}
                placeholder={t('delivery_reps.driver_new_load_requisition_view.s54', "اختر المستودع...")}
                disabled={isLoadingWarehouses}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
              <div style={{ flex: '1 1 50%', minWidth: 0 }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '2px', whiteSpace: 'nowrap' }}>
                  {isAdmin ? t('delivery_reps.driver_new_load_requisition_view.s55', "المندوب (السائق) *") : t('delivery_reps.driver_new_load_requisition_view.s56', "المندوب (المستلم)")}
                </label>
                {isAdmin ? (
                  <CustomSelect
                    value={selectedRepId}
                    onChange={(val) => setSelectedRepId(val)}
                    options={repSelectOptions}
                    placeholder={t('delivery_reps.driver_new_load_requisition_view.s57', "اختر المندوب...")}
                    disabled={adminRepsQuery.isLoading}
                  />
                ) : (
                  <input
                    type="text"
                    readOnly
                    value={driverName}
                    style={{
                      width: '100%',
                      height: '32px',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '7px',
                      padding: '0 8px',
                      fontSize: '11.5px',
                      color: '#0f172a',
                      fontWeight: 700,
                      boxSizing: 'border-box',
                    }}
                  />
                )}
              </div>

              <div style={{ flex: '1 1 50%', minWidth: 0 }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '2px', whiteSpace: 'nowrap' }}>
                  {t('delivery_reps.driver_new_load_requisition_view.s58', "السيارة")}
                </label>
                <input
                  type="text"
                  readOnly
                  value={displayVehiclePlate}
                  style={{
                    width: '100%',
                    height: '32px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '7px',
                    padding: '0 8px',
                    fontSize: '11.5px',
                    color: '#0f172a',
                    fontWeight: 700,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          </div>
        </section>

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

        {/* TAB 1: CATALOG VIEW (Orders-style Browsing & Instant Steppers) */}
        {activeViewTab === 'catalog' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* SEARCH INPUT */}
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type="text"
                placeholder={t('delivery_reps.driver_new_load_requisition_view.s61', "ابحث بالاسم أو الباركود في كافة المخزن...")}
                value={catalogSearchQuery}
                onChange={(e) => setCatalogSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  height: '38px',
                  padding: catalogSearchQuery ? '0 32px 0 32px' : '0 32px 0 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '12.5px',
                  boxSizing: 'border-box',
                  backgroundColor: '#ffffff',
                  outline: 'none',
                }}
              />
              <SearchIcon
                size={15}
                color="#94a3b8"
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                }}
              />
              {catalogSearchQuery && (
                <button
                  type="button"
                  onClick={() => setCatalogSearchQuery('')}
                  style={{
                    position: 'absolute',
                    left: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: '#f1f5f9',
                    border: 'none',
                    borderRadius: '50%',
                    width: '22px',
                    height: '22px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#64748b',
                    padding: 0,
                  }}
                  title={t('delivery_reps.driver_new_load_requisition_view.s62', "مسح البحث")}
                >
                  <XIcon size={13} />
                </button>
              )}
            </div>

            {/* CATALOG WORKFLOW */}
            {catalogSearchQuery.trim() ? (
              /* SEARCH RESULTS VIEW */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px', fontSize: '11.5px' }}>
                  <span style={{ color: '#475569', fontWeight: 700 }}>
                    {t('delivery_reps.driver_new_load_requisition_view.s63', "نتائج البحث: (")}{displayedProducts.length} {t('delivery_reps.driver_new_load_requisition_view.s64', "صنف)")}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {outOfStockCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowOutOfStock((prev) => !prev)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: showOutOfStock ? '#170e5e' : '#64748b',
                          fontWeight: 700,
                          fontSize: '11px',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          padding: 0,
                        }}
                      >
                        {showOutOfStock ? t('delivery_reps.driver_new_load_requisition_view.s65', "إخفاء غير المتوفر") : `عرض غير المتوفر (${outOfStockCount})`}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setCatalogSearchQuery('')}
                      style={{ background: 'none', border: 'none', color: '#170e5e', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                    >
                      {t('delivery_reps.driver_new_load_requisition_view.s66', "العودة لتصفح الشركات")}
                    </button>
                  </div>
                </div>

                {renderProductsList(displayedProducts)}
              </div>
            ) : !selectedCompany ? (
              /* COMPANIES GRID VIEW (DEFAULT) */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
                    <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                      {t('delivery_reps.driver_new_load_requisition_view.s67', "شركات وموردي البضاعة (")}{companies.length})
                    </span>
                  </div>
                  {companies.some((c) => c.availableProducts === 0) && (
                    <button
                      type="button"
                      onClick={() => setHideOutOfStockCompanies((prev) => !prev)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: hideOutOfStockCompanies ? '#170e5e' : '#64748b',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      {hideOutOfStockCompanies ? t('delivery_reps.driver_new_load_requisition_view.s68', "عرض كل الشركات") : t('delivery_reps.driver_new_load_requisition_view.s69', "المتوفر فقط")}
                    </button>
                  )}
                </div>

                {displayedCompanies.length === 0 ? (
                  <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                    {t('delivery_reps.driver_new_load_requisition_view.s70', "لا توجد شركات مطابقة بالمخزن حالياً")}
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                      gap: '8px',
                    }}
                  >
                    {/* ALL PRODUCTS MASTER CARD */}
                    <div
                      onClick={() => {
                        setSelectedCompany('__ALL__');
                        setSelectedCategory('all');
                      }}
                      style={{
                        backgroundColor: '#ffffff',
                        border: '1.5px solid #170e5e',
                        borderRadius: '12px',
                        padding: '9px 8px',
                        cursor: 'pointer',
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                        boxShadow: '0 1px 3px rgba(23,14,94,0.06)',
                      }}
                    >
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '9px',
                          backgroundColor: '#170e5e',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#ffffff',
                        }}
                      >
                        <BoxesIcon size={16} />
                      </div>

                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: '11.5px',
                          color: '#170e5e',
                          maxWidth: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={t('delivery_reps.driver_new_load_requisition_view.s71', "كافة أصناف المخزن")}
                      >
                        {t('delivery_reps.driver_new_load_requisition_view.s72', "كافة الأصناف")}
                      </span>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            color: totalAvailableItemsCount > 0 ? '#15803d' : '#94a3b8',
                            backgroundColor: totalAvailableItemsCount > 0 ? '#ecfdf5' : '#f1f5f9',
                            border: `1px solid ${totalAvailableItemsCount > 0 ? '#bbf7d0' : '#e2e8f0'}`,
                            padding: '1px 6px',
                            borderRadius: '10px',
                          }}
                        >
                          {totalAvailableItemsCount > 0 ? `${totalAvailableItemsCount} صنف متاح` : `${(availableProducts || []).length} صنف`}
                        </span>
                        {distinctItemsCount > 0 && (
                          <span
                            style={{
                              fontSize: '9.5px',
                              fontWeight: 800,
                              color: '#170e5e',
                              backgroundColor: '#e0e7ff',
                              border: '1px solid #c7d2fe',
                              padding: '1px 5px',
                              borderRadius: '10px',
                            }}
                          >
                            {distinctItemsCount} {t('delivery_reps.driver_new_load_requisition_view.s73', "بالطلب")}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* INDIVIDUAL COMPANY CARDS */}
                    {displayedCompanies.map((comp) => {
                      const inReqCount = linesCompanyCounts.get(comp.name) || 0;
                      return (
                        <div
                          key={comp.name}
                          onClick={() => {
                            setSelectedCompany(comp.name);
                            setSelectedCategory('all');
                          }}
                          style={{
                            backgroundColor: inReqCount > 0 ? '#fbfbfe' : '#ffffff',
                            border: inReqCount > 0 ? '1.5px solid #a5b4fc' : '1px solid #e2e8f0',
                            borderRadius: '12px',
                            padding: '9px 8px',
                            cursor: 'pointer',
                            textAlign: 'center',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '4px',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                          }}
                        >
                          <div
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '9px',
                              backgroundColor: '#eef2ff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#170e5e',
                            }}
                          >
                            <BuildingIcon size={16} />
                          </div>

                          <span
                            style={{
                              fontWeight: 800,
                              fontSize: '11.5px',
                              color: '#0f172a',
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={comp.name}
                          >
                            {comp.name}
                          </span>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap', justifyContent: 'center' }}>
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                color: comp.availableProducts > 0 ? '#047857' : '#94a3b8',
                                backgroundColor: comp.availableProducts > 0 ? '#f0fdf4' : '#f1f5f9',
                                border: `1px solid ${comp.availableProducts > 0 ? '#bbf7d0' : '#e2e8f0'}`,
                                padding: '1px 6px',
                                borderRadius: '10px',
                              }}
                            >
                              {comp.availableProducts > 0 ? `${comp.availableProducts} صنف متاح` : t('delivery_reps.driver_new_load_requisition_view.s74', "نفد الرصيد")}
                            </span>
                            {inReqCount > 0 && (
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  fontWeight: 800,
                                  color: '#170e5e',
                                  backgroundColor: '#e0e7ff',
                                  border: '1px solid #c7d2fe',
                                  padding: '1px 5px',
                                  borderRadius: '10px',
                                }}
                              >
                                {inReqCount} {t('delivery_reps.driver_new_load_requisition_view.s75', "بالطلب")}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* SELECTED COMPANY VIEW: HORIZONTAL CATEGORIES BAR & PRODUCTS */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* COMPANY HEADER WITH BACK BUTTON */}
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    padding: '7px 10px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCompany(null);
                        setSelectedCategory('all');
                      }}
                      style={{
                        height: '28px',
                        padding: '0 8px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#f8fafc',
                        color: '#170e5e',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                      title={t('delivery_reps.driver_new_load_requisition_view.s76', "الرجوع لقائمة الشركات")}
                    >
                      <ArrowRightIcon size={13} />
                      <span>{t('delivery_reps.driver_new_load_requisition_view.s77', "الشركات")}</span>
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: '12.5px',
                          fontWeight: 800,
                          color: '#0f172a',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={selectedCompany === '__ALL__' ? t('delivery_reps.driver_new_load_requisition_view.s78', "كافة أصناف المخزن") : selectedCompany || ''}
                      >
                        {selectedCompany === '__ALL__' ? t('delivery_reps.driver_new_load_requisition_view.s79', "كافة أصناف المخزن") : selectedCompany}
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          color: '#170e5e',
                          fontWeight: 700,
                          backgroundColor: '#eef2ff',
                          padding: '1px 6px',
                          borderRadius: '8px',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                      >
                        {displayedProducts.length} {t('delivery_reps.driver_new_load_requisition_view.s80', "صنف")}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    {outOfStockCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowOutOfStock((prev) => !prev)}
                        style={{
                          height: '26px',
                          padding: '0 8px',
                          borderRadius: '6px',
                          border: showOutOfStock ? '1px solid #c7d2fe' : '1px solid #cbd5e1',
                          backgroundColor: showOutOfStock ? '#e0e7ff' : '#f8fafc',
                          color: showOutOfStock ? '#170e5e' : '#475569',
                          fontWeight: 700,
                          fontSize: '10.5px',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                      >
                        {showOutOfStock ? t('delivery_reps.driver_new_load_requisition_view.s81', "إخفاء غير المتوفر") : `عرض غير المتوفر (${outOfStockCount})`}
                      </button>
                    )}
                  </div>
                </div>

                {/* HORIZONTAL CATEGORIES BAR (DEFAULT IS 'all') */}
                <div
                  style={{
                    display: 'flex',
                    gap: '6px',
                    overflowX: 'auto',
                    padding: '1px 0 4px',
                    scrollbarWidth: 'none',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('all')}
                    style={{
                      height: '28px',
                      padding: '0 10px',
                      borderRadius: '14px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      border: selectedCategory === 'all' ? '1px solid #170e5e' : '1px solid #cbd5e1',
                      backgroundColor: selectedCategory === 'all' ? '#170e5e' : '#ffffff',
                      color: selectedCategory === 'all' ? '#ffffff' : '#475569',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      flexShrink: 0,
                    }}
                  >
                    <span>{t('delivery_reps.driver_new_load_requisition_view.s82', "الكل")}</span>
                    <span style={{ opacity: selectedCategory === 'all' ? 0.9 : 0.7, fontSize: '10px' }}>
                      ({selectedCompany === '__ALL__' ? (availableProducts || []).length : (availableProducts || []).filter((p) => ((p.supplierName || '').trim() || t('delivery_reps.driver_new_load_requisition_view.s83', "الشركة العامة")) === selectedCompany).length})
                    </span>
                  </button>

                  {companyCategories.map((cat) => (
                    <button
                      key={cat.name}
                      type="button"
                      onClick={() => setSelectedCategory(cat.name)}
                      style={{
                        height: '28px',
                        padding: '0 10px',
                        borderRadius: '14px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        border: selectedCategory === cat.name ? '1px solid #170e5e' : '1px solid #cbd5e1',
                        backgroundColor: selectedCategory === cat.name ? '#170e5e' : '#ffffff',
                        color: selectedCategory === cat.name ? '#ffffff' : '#475569',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        flexShrink: 0,
                      }}
                    >
                      <bdi>{cat.name}</bdi>
                      <span style={{ opacity: selectedCategory === cat.name ? 0.9 : 0.7, fontSize: '10px' }}>
                        ({cat.count})
                      </span>
                    </button>
                  ))}
                </div>

                {/* PRODUCTS LIST */}
                {renderProductsList(displayedProducts)}
              </div>
            )}
          </div>
        )}

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
