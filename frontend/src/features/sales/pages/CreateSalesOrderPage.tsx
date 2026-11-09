import { useTranslation } from 'react-i18next';
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateSalesOrderForm, type SalesOrderItem } from '../hooks/useCreateSalesOrderForm';
import { useSalesOrderWarehouse } from '../hooks/useSalesOrderWarehouse';
import { useProductsQuery } from '@/shared/hooks/use-catalog-queries';
import { useAppToolbar } from '@/stores/toolbar-store';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { SearchableCombobox } from '@/shared/ui/searchable-combobox';
import { toast } from '@/shared/components/system-alert';
import { useFormDraft } from '@/shared/hooks/use-form-draft';
import { DraftRestoredBanner } from '@/shared/components/DraftRestoredBanner';
import { matchesArabic } from '@/lib/arabic-normalization';
import { formatCurrency, formatCurrencyWithSymbol } from '@/lib/format';
import { LockIcon, PackageIcon } from '@/shared/components/icons/AppIcons';
import type { Product } from '@/types/domain';

interface SalesOrderFormItem extends SalesOrderItem {
  id: number;
  stockOnHand?: number;
  barcode?: string;
  warehouse?: string;
}

export function CreateSalesOrderPage() {
  const { t } = useTranslation();
  useAppToolbar([
    { label: 'المبيعات', to: '/sales' },
    { label: 'أوامر البيع وحجز المخزون', to: '/sales/orders' },
    { label: 'أمر بيع جديد' },
  ]);

  const navigate = useNavigate();

  // Header State
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [paymentType, setPaymentType] = useState<'cash' | 'credit'>('credit');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [deliveryDate, setDeliveryDate] = useState(
    new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [reservationExpiresAt, setReservationExpiresAt] = useState(
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [autoReserve, setAutoReserve] = useState(true);
  const [currency, setCurrency] = useState('EGP');

  // Quick Action State
  const [activeQuickAction, setActiveQuickAction] = useState<'tax' | 'discount' | null>(null);
  const [taxRate, setTaxRate] = useState<number>(0);
  const [discountMode, setDiscountMode] = useState<'percent' | 'value'>('value');
  const [discountValue, setDiscountValue] = useState<number>(0);

  // Notes & Terms
  const [notes, setNotes] = useState('');
  const [termsConditions, setTermsConditions] = useState(
    '1. يتم حجز الأصناف المحددة بالمخزون لحين استلام العميل وسداد قيمة الفاتورة.\n2. يلغى حجز المخزون تلقائياً بعد انتهاء مهلة صلاحية الحجز المحددة.'
  );

  // Attachments State
  const [attachments, setAttachments] = useState<File[]>([]);
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      setAttachments((prev) => [...prev, ...newFiles]);
      toast.success(`تم إرفاق ${newFiles.length} ملف بنجاح`);
    }
  };

  // Items State
  const [items, setItems] = useState<SalesOrderFormItem[]>([
    {
      id: Date.now(),
      productId: 0,
      productName: '',
      unitName: 'قطعة',
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      total: 0,
      stockOnHand: 0,
      warehouse: 'المستودع الرئيسي',
    },
  ]);

  // Feature Hook for Data Access
  const { data: catalogProducts = [] } = useProductsQuery();
  const {
    customers,
    createSalesOrder,
    isSubmitting,
  } = useCreateSalesOrderForm({
    onSuccess: () => {
      clearDraft();
      navigate('/sales/orders');
    },
  });

  const customerOptions = useMemo(() => {
    return (customers || []).map((c: any) => ({
      id: String(c.id),
      rawId: Number(c.id),
      name: c.name || '',
      phone: c.phone || '',
      address: c.address || '',
      code: c.code || '',
    }));
  }, [customers]);

  const {
    selectedWarehouseId,
    selectWarehouse,
    resetWarehouse,
    warehouseOptions,
    availabilityByProduct,
    refreshAvailability,
  } = useSalesOrderWarehouse();

  const productOptions = useMemo(() => {
    return (catalogProducts || []).map((p: Product) => ({
      id: String(p.id),
      rawId: Number(p.id),
      name: p.name || '',
      barcode: p.barcode || '',
      sku: p.sku || '',
      price: Number(p.retailPrice ?? p.wholesalePrice ?? 0),
      costPrice: Number(p.costPrice ?? 0),
      unit: p.units?.[0]?.name || (p as any).unit || 'قطعة',
      stock: Number(p.stock ?? 0),
      raw: p,
    }));
  }, [catalogProducts]);

  // INV-SALES-ORDER-RESERVED-STOCK-DISPLAY: the picker suggestion
  // shows ONLY the reserved-aware availability in the selected
  // warehouse — never the catalog stock (p.stock = products.stock_qty,
  // on-hand before reservations, in no warehouse in particular).
  // Availability is fetched for the options the dropdown is about to
  // show (same predicate and 8-option cap as SearchableCombobox),
  // when the dropdown opens and, debounced, while the user types.
  const pickerRefreshTimerRef = useRef<number | null>(null);

  const visibleProductIds = useCallback(
    (query: string) => {
      const q = (query || '').trim();
      const matched = productOptions.filter(
        (p) =>
          matchesArabic(p.name, q) ||
          (p.barcode ? p.barcode.includes(q) : false) ||
          (p.sku ? p.sku.toLowerCase().includes(q.toLowerCase()) : false),
      );
      return matched.slice(0, 8).map((p) => p.rawId);
    },
    [productOptions],
  );

  const refreshPickerAvailability = useCallback(
    (query: string) => {
      const ids = visibleProductIds(query);
      if (ids.length > 0) void refreshAvailability(ids);
    },
    [visibleProductIds, refreshAvailability],
  );

  const schedulePickerAvailabilityRefresh = useCallback(
    (query: string) => {
      if (pickerRefreshTimerRef.current) window.clearTimeout(pickerRefreshTimerRef.current);
      pickerRefreshTimerRef.current = window.setTimeout(() => refreshPickerAvailability(query), 250);
    },
    [refreshPickerAvailability],
  );

  useEffect(
    () => () => {
      if (pickerRefreshTimerRef.current) window.clearTimeout(pickerRefreshTimerRef.current);
    },
    [],
  );

  // INV-SALES-ORDER-WAREHOUSE-SELECTION: whenever the selected
  // warehouse changes (or a line's product changes), re-read the
  // availability of every line product IN THAT WAREHOUSE — the same
  // read the approval check enforces — and show it on the line.
  const lineProductIdsKey = items.map((it) => it.productId).filter((id) => id > 0).join(',');
  useEffect(() => {
    const ids = items.map((it) => it.productId).filter((id) => id > 0);
    if (ids.length > 0) void refreshAvailability(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWarehouseId, lineProductIdsKey, refreshAvailability]);

  useEffect(() => {
    setItems((prev) => {
      let changed = false;
      const next = prev.map((it) => {
        const avail = it.productId > 0 ? availabilityByProduct[it.productId] : undefined;
        if (avail === undefined || avail === it.stockOnHand) return it;
        changed = true;
        return { ...it, stockOnHand: avail };
      });
      return changed ? next : prev;
    });
  }, [availabilityByProduct]);

  // Draft Data
  const draftData = useMemo(
    () => ({
      selectedCustomerId,
      customerName,
      customerPhone,
      customerAddress,
      paymentType,
      orderDate,
      deliveryDate,
      reservationExpiresAt,
      autoReserve,
      currency,
      taxRate,
      discountMode,
      discountValue,
      notes,
      termsConditions,
      items,
      warehouseLocationId: selectedWarehouseId,
    }),
    [
      selectedCustomerId,
      customerName,
      customerPhone,
      customerAddress,
      paymentType,
      orderDate,
      deliveryDate,
      reservationExpiresAt,
      autoReserve,
      currency,
      taxRate,
      discountMode,
      discountValue,
      notes,
      termsConditions,
      items,
      selectedWarehouseId,
    ]
  );

  const resetForm = () => {
    clearDraft();
    resetWarehouse();
    setSelectedCustomerId(null);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setPaymentType('credit');
    setOrderDate(new Date().toISOString().split('T')[0]);
    setDeliveryDate(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
    setReservationExpiresAt(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
    setAutoReserve(true);
    setTaxRate(0);
    setDiscountMode('value');
    setDiscountValue(0);
    setNotes('');
    setItems([
      {
        id: Date.now(),
        productId: 0,
        productName: '',
        unitName: 'قطعة',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        total: 0,
        stockOnHand: 0,
        warehouse: 'المستودع الرئيسي',
      },
    ]);
  };

  const { clearDraft, isDraftRestored, dismissRestoredNotice } = useFormDraft({
    key: 'z_draft_sales_order_fullpage',
    data: draftData,
    isEmpty: (d) => {
      const hasHeader = Boolean(d.customerName?.trim() || d.customerPhone?.trim() || d.notes?.trim());
      const hasItems = Array.isArray(d.items) && d.items.some((it) => Boolean(it.productId > 0 || it.productName?.trim()));
      return !hasHeader && !hasItems;
    },
    onRestore: (saved) => {
      if (saved.selectedCustomerId) setSelectedCustomerId(saved.selectedCustomerId);
      if (saved.customerName) setCustomerName(saved.customerName);
      if (saved.customerPhone) setCustomerPhone(saved.customerPhone);
      if (saved.customerAddress) setCustomerAddress(saved.customerAddress);
      if (saved.paymentType) setPaymentType(saved.paymentType);
      if (saved.orderDate) setOrderDate(saved.orderDate);
      if (saved.deliveryDate) setDeliveryDate(saved.deliveryDate);
      if (saved.reservationExpiresAt) setReservationExpiresAt(saved.reservationExpiresAt);
      if (typeof saved.autoReserve === 'boolean') setAutoReserve(saved.autoReserve);
      if (saved.currency) setCurrency(saved.currency);
      if (typeof saved.taxRate === 'number') setTaxRate(saved.taxRate);
      if (saved.discountMode) setDiscountMode(saved.discountMode);
      if (typeof saved.discountValue === 'number') setDiscountValue(saved.discountValue);
      if (saved.notes) setNotes(saved.notes);
      if (saved.termsConditions) setTermsConditions(saved.termsConditions);
      if (saved.warehouseLocationId) selectWarehouse(Number(saved.warehouseLocationId));
      if (Array.isArray(saved.items) && saved.items.length > 0) {
        // INV-SALES-ORDER-RESERVED-STOCK-DISPLAY: a saved stockOnHand
        // is stale the moment another order reserves the stock — never
        // show the persisted number as if it were live. A restored
        // line starts at 0 (like a fresh line) until the reserved-aware
        // read returns and the sync effect fills it in.
        setItems(saved.items.map((it: any) => ({ ...it, stockOnHand: 0 })));
      }
    },
  });

  // Line Handlers
  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        productId: 0,
        productName: '',
        unitName: 'قطعة',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        total: 0,
        stockOnHand: 0,
        warehouse: 'المستودع الرئيسي',
      },
    ]);
  };

  const handleAddServiceLine = () => {
    setItems((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        productId: 0,
        productName: 'خدمة شحن وتوصيل',
        unitName: 'خدمة',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        total: 0,
        stockOnHand: 0,
        warehouse: 'لا يؤثر على المخزون',
      },
    ]);
  };

  const handleRemoveItem = (id: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleUpdateLine = (id: number, field: keyof SalesOrderFormItem, value: any) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        const qty = Number(field === 'quantity' ? value : updated.quantity) || 0;
        const price = Number(field === 'unitPrice' ? value : updated.unitPrice) || 0;
        const disc = Number(field === 'discount' ? value : updated.discount) || 0;
        updated.total = Math.max(0, qty * price - disc);
        return updated;
      })
    );
  };

  const handleProductSelect = (id: number, option: any) => {
    // INV-SALES-ORDER-WAREHOUSE-SELECTION: the badge shows the
    // availability in the SELECTED warehouse (0 until the read
    // returns), never the global stock — then re-read it live.
    const knownAvailability = availabilityByProduct[option.rawId];
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const qty = item.quantity || 1;
        const price = option.price || 0;
        const disc = item.discount || 0;
        return {
          ...item,
          productId: option.rawId,
          productName: option.name,
          unitName: option.unit,
          unitPrice: price,
          stockOnHand: knownAvailability ?? 0,
          barcode: option.barcode,
          total: Math.max(0, qty * price - disc),
        };
      })
    );
    void refreshAvailability([option.rawId]);
  };

  const handleBarcodeScan = () => {
    const barcode = window.prompt('امسح أو أدخل باركود الصنف:');
    if (barcode && barcode.trim()) {
      const found = productOptions.find((p) => p.barcode === barcode.trim() || p.sku === barcode.trim());
      if (found) {
        setItems((prev) => [
          ...prev,
          {
            id: Date.now() + Math.random(),
            productId: found.rawId,
            productName: found.name,
            unitName: found.unit,
            quantity: 1,
            unitPrice: found.price,
            discount: 0,
            total: found.price,
            // INV-SALES-ORDER-WAREHOUSE-SELECTION: selected-warehouse
            // availability, never the global stock.
            stockOnHand: availabilityByProduct[found.rawId] ?? 0,
            warehouse: 'المستودع الرئيسي',
          },
        ]);
        void refreshAvailability([found.rawId]);
        toast.success(`تمت إضافة الصنف: ${found.name}`);
      } else {
        toast.warning('لم يتم العثور على صنف بهذا الباركود');
      }
    }
  };

  // Calculations
  const subtotal = useMemo(() => {
    return items.reduce((acc, it) => acc + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
  }, [items]);

  const itemsDiscountTotal = useMemo(() => {
    return items.reduce((acc, it) => acc + (Number(it.discount) || 0), 0);
  }, [items]);

  const globalDiscountAmount = useMemo(() => {
    if (discountMode === 'percent') {
      return (subtotal * discountValue) / 100;
    }
    return discountValue;
  }, [subtotal, discountMode, discountValue]);

  const totalDiscount = itemsDiscountTotal + globalDiscountAmount;
  const taxableAmount = Math.max(0, subtotal - totalDiscount);
  const taxAmount = (taxableAmount * taxRate) / 100;
  const totalAmount = Math.max(0, taxableAmount + taxAmount);

  const handleSubmit = () => {
    if (!customerName.trim()) {
      toast.error('يرجى إدخال اسم العميل');
      return;
    }

    const validItems = items.filter((it) => it.productName.trim() && Number(it.quantity) > 0);
    if (validItems.length === 0) {
      toast.error('يرجى إضافة صنف واحد على الأقل باسم وكمية صحيحة');
      return;
    }

    createSalesOrder({
      customerId: selectedCustomerId,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      customerAddress: customerAddress.trim() || undefined,
      // INV-SALES-ORDER-WAREHOUSE-SELECTION: reserve in the warehouse
      // the user selected (default = the branch's default selling
      // warehouse); omit it only when none resolved yet, so the
      // backend falls back to the branch default.
      warehouseLocationId: selectedWarehouseId ?? undefined,
      deliveryDate: deliveryDate || undefined,
      reservationExpiresAt: reservationExpiresAt || undefined,
      autoReserve,
      subtotal,
      discountAmount: totalDiscount,
      taxAmount,
      totalAmount,
      notes: notes.trim() || undefined,
      termsConditions: termsConditions.trim() || undefined,
      items: validItems.map((it) => ({
        productId: it.productId,
        productName: it.productName.trim(),
        unitName: it.unitName?.trim(),
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        discount: Number(it.discount || 0),
        total: Number(it.total),
        notes: it.notes?.trim(),
      })),
    });
  };

  return (
    <div className="purchase-prototype-theme-root" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '32px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        {/* Universal Document Header */}
        <PageHeader
          title={t('sales.create_sales_order_page.s0', "أمر بيع جديد")}
          onBack={() => navigate('/sales/orders')}
          badge={
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span className="document-prototype-status-badge is-draft">{t('sales.create_sales_order_page.s1', "مسودة")}</span>
              <span className="nav-pill" style={{ fontWeight: 700, color: '#0f172a' }}>
                {t('sales.create_sales_order_page.s2', "الإجمالي:")} {formatCurrencyWithSymbol(totalAmount, currency)}
              </span>
            </div>
          }
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="secondary"
                type="button"
                className="purchase-prototype-toolbar-action purchase-prototype-toolbar-action-secondary"
                onClick={() => navigate('/sales/orders')}
                style={{ color: 'var(--danger-color)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
              >
                <span>{t('sales.create_sales_order_page.s3', "إلغاء المسودة")}</span>
              </Button>
              <Button
                variant="secondary"
                type="button"
                className="purchase-prototype-toolbar-action purchase-prototype-toolbar-action-secondary"
                onClick={() => {
                  toast.success(t('sales.create_sales_order_page.s4', "تم حفظ مسودة أمر البيع بنجاح"));
                }}
              >
                <span>{t('sales.create_sales_order_page.s5', "حفظ كمسودة")}</span>
              </Button>
              <Button
                type="button"
                className="purchase-prototype-toolbar-action purchase-prototype-toolbar-action-primary"
                onClick={() => handleSubmit()}
                disabled={isSubmitting}
                style={{ backgroundColor: '#170e5e', color: '#ffffff' }}
              >
                <span>{isSubmitting ? t('sales.create_sales_order_page.s6', "جارٍ الاعتماد...") : t('sales.create_sales_order_page.s7', "اعتماد أمر البيع")}</span>
              </Button>
            </div>
          }
        />

        <DraftRestoredBanner
          show={isDraftRestored}
          onClear={resetForm}
          onDismiss={dismissRestoredNotice}
        />

        {/* Section 1: Basic Info */}
        <section className="document-prototype-section" style={{ marginTop: '12px' }}>
          <div className="section-header-compact-row" style={{ marginBottom: '0.6rem' }}>
            <h3 className="document-prototype-section-title">{t('sales.create_sales_order_page.s8', "المعلومات الأساسية")}</h3>
            <div className="section-header-actions-group" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <label className="section-header-action-btn purchase-camera-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', margin: 0 }}>
                <input type="file" accept="image/*" capture="environment" onChange={handleFileUpload} style={{ display: 'none' }} />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span>{t('sales.create_sales_order_page.s9', "كاميرا")}</span>
              </label>
              <label className="section-header-action-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', margin: 0 }}>
                <input type="file" multiple onChange={handleFileUpload} style={{ display: 'none' }} />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                  <path d="M21 12.5 12.8 20.7a5 5 0 0 1-7.1-7.1L14.2 5.1a3.5 3.5 0 0 1 4.9 4.9L9.9 19.2" />
                </svg>
                <span>{t('sales.create_sales_order_page.s10', "إرفاق")}</span>
                {attachments.length > 0 && <span className="nav-pill" style={{ fontSize: '0.65rem', padding: '1px 4px', marginInlineStart: '2px' }}>{attachments.length}</span>}
              </label>
            </div>
          </div>

          <div className="purchase-prototype-form-grid">
            {/* Customer Name */}
            <SearchableCombobox
              label={t('sales.create_sales_order_page.s11', "العميل *")}
              placeholder={t('sales.create_sales_order_page.s12', "ابحث عن عميل بالاسم أو الهاتف...")}
              value={customerName}
              onChange={(value) => {
                setCustomerName(value);
                const found = customers.find((c: any) => c.name === value);
                if (found) {
                  setSelectedCustomerId(Number(found.id));
                  setCustomerPhone(found.phone || '');
                  setCustomerAddress(found.address || '');
                } else {
                  setSelectedCustomerId(null);
                }
              }}
              options={customerOptions}
              search={(c, query) => matchesArabic(c.name, query) || (c.phone ? c.phone.includes(query) : false)}
              getLabel={(c) => c.name}
              getMeta={(c) => [c.code, c.phone].filter(Boolean).join(' · ')}
              onSelect={(c) => {
                setSelectedCustomerId(c.rawId);
                setCustomerName(c.name);
                setCustomerPhone(c.phone || '');
                setCustomerAddress(c.address || '');
              }}
              inputClassName="purchase-prototype-field-input"
              emptyLabel={t('sales.create_sales_order_page.s13', "عميل جديد غير مسجل (يمكنك المتابعة بالاسم المدخل)")}
            />

            {/* Customer Phone */}
            <Field label={t('sales.create_sales_order_page.s14', "رقم الهاتف")}>
              <input
                className="purchase-prototype-field-input"
                type="text"
                placeholder={t('sales.create_sales_order_page.s15', "ابحث عن رقم تليفون أو أدخله...")}
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </Field>

            {/* Payment Type */}
            <Field label={t('sales.create_sales_order_page.s16', "طريقة الدفع / المعاملة")}>
              <CustomSelect
                value={paymentType}
                onChange={(val) => setPaymentType(val as 'cash' | 'credit')}
                options={[
                  { value: 'credit', label: t('sales.create_sales_order_page.s17', "آجل (حساب المديونية للعميل)") },
                  { value: 'cash', label: t('sales.create_sales_order_page.s18', "نقدي (سداد فوري عند الاستلام)") },
                ]}
                placeholder={t('sales.create_sales_order_page.s19', "اختر طريقة الدفع...")}
              />
            </Field>

            {/* Order Date */}
            <Field label={t('sales.create_sales_order_page.s20', "تاريخ أمر البيع")}>
              <input
                className="purchase-prototype-field-input"
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
              />
            </Field>

            {/* Expected Delivery Date */}
            <Field label={t('sales.create_sales_order_page.s21', "تاريخ التسليم المتوقع")}>
              <input
                className="purchase-prototype-field-input"
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </Field>

            {/* Currency */}
            <Field label={t('sales.create_sales_order_page.s22', "العملة")}>
              <CustomSelect
                value={currency}
                onChange={(val) => setCurrency(val)}
                options={[
                  { value: 'EGP', label: t('sales.create_sales_order_page.s23', "EGP - جنيه مصري") },
                  { value: 'USD', label: t('sales.create_sales_order_page.s24', "USD - دولار أمريكي") },
                  { value: 'SAR', label: t('sales.create_sales_order_page.s25', "SAR - ريال سعودي") },
                  { value: 'AED', label: t('sales.create_sales_order_page.s26', "AED - درهم إماراتي") },
                ]}
                placeholder={t('sales.create_sales_order_page.s27', "اختر العملة...")}
              />
            </Field>
          </div>
        </section>

        {/* Section 2: Stock Reservation & Delivery Settings */}
        <section className="document-prototype-section" style={{ marginTop: '12px' }}>
          <h3 className="document-prototype-section-title">{t('sales.create_sales_order_page.s28', "حجز المخزون وموقع التسليم")}</h3>
          <div className="purchase-prototype-form-grid" style={{ marginBottom: '14px' }}>
            <Field label={t('sales.create_sales_order_page.s29', "صلاحية حجز المخزون حتى")}>
              <input
                className="purchase-prototype-field-input"
                type="date"
                value={reservationExpiresAt}
                onChange={(e) => setReservationExpiresAt(e.target.value)}
              />
            </Field>

            <Field label={t('sales.create_sales_order_page.s30', "عنوان العميل / موقع التسليم")}>
              <input
                className="purchase-prototype-field-input"
                type="text"
                placeholder={t('sales.create_sales_order_page.s31', "العنوان التفصيلي للتسليم أو الاستلام...")}
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
              />
            </Field>

            {/* INV-SALES-ORDER-WAREHOUSE-SELECTION: the warehouse the
            order reserves from. Defaults to the branch's default
            selling warehouse; the line availability and the approval
            check both read this warehouse. */}
            <Field label={t('sales.create_sales_order_page.s79', "مخزن الحجز")}>
              <CustomSelect
                value={selectedWarehouseId != null ? String(selectedWarehouseId) : ''}
                onChange={(val) => selectWarehouse(val ? Number(val) : null)}
                options={warehouseOptions}
                placeholder={t('sales.create_sales_order_page.s80', "اختر المخزن...")}
              />
            </Field>
          </div>

          {/* Auto Reservation Banner */}
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: autoReserve ? '#eff6ff' : '#f8fafc',
              borderRadius: '8px',
              border: `1px solid ${autoReserve ? '#bfdbfe' : '#e2e8f0'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <LockIcon size={18} color={autoReserve ? '#1d4ed8' : '#64748b'} />
              <div>
                <span style={{ fontSize: '13px', fontWeight: 700, color: autoReserve ? '#1e3a8a' : '#334155', display: 'block' }}>
                  {t('sales.create_sales_order_page.s32', "تفعيل حجز المخزون التلقائي فور الحفظ (Stock Reservation)")}
                </span>
                <span style={{ fontSize: '11.5px', color: autoReserve ? '#2563eb' : '#64748b' }}>
                  {t('sales.create_sales_order_page.s33', "يتم زيادة الكمية المحجوزة للمنتجات ومنع بيعها في الكاشير أو المتجر الإلكتروني حتى إتمام الفاتورة.")}
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={autoReserve}
              onChange={(e) => setAutoReserve(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
          </div>
        </section>

        {/* Section 3: Items Table */}
        <section className="document-prototype-section" style={{ marginTop: '12px' }}>
          <div className="section-header-compact-row" style={{ marginBottom: '0.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <PackageIcon size={16} color="#170e5e" />
              <h3 className="document-prototype-section-title" style={{ margin: 0 }}>{t('sales.create_sales_order_page.s34', "الأصناف والكميات")}</h3>
              <span className="nav-pill" style={{ fontSize: '0.72rem', padding: '2px 8px' }}>({items.length} {t('sales.create_sales_order_page.s35', "صنف)")}</span>
            </div>
            <div className="purchase-prototype-quick-actions" aria-label={t('sales.create_sales_order_page.s36', "إجراءات سريعة")}>
              <button
                type="button"
                className="purchase-prototype-quick-action"
                title={t('sales.create_sales_order_page.s37', "إضافة صنف جديد")}
                onClick={handleAddItem}
                style={{ fontWeight: 700, color: '#1e40af' }}
              >
                <span aria-hidden="true">+</span>
                <span>{t('sales.create_sales_order_page.s38', "صنف")}</span>
              </button>
              <button
                type="button"
                className="purchase-prototype-quick-action"
                title={t('sales.create_sales_order_page.s39', "إضافة بند خدمة أو شحن")}
                onClick={handleAddServiceLine}
                style={{ fontWeight: 700, color: '#0284c7' }}
              >
                <span aria-hidden="true">+</span>
                <span>{t('sales.create_sales_order_page.s40', "خدمة")}</span>
              </button>
              <button
                type="button"
                className="purchase-prototype-quick-action"
                title={t('sales.create_sales_order_page.s41', "تطبيق ضريبة")}
                onClick={() => setActiveQuickAction((curr) => (curr === 'tax' ? null : 'tax'))}
                style={
                  taxRate > 0
                    ? { borderColor: '#2563eb', color: '#1d4ed8', backgroundColor: '#eff6ff', fontWeight: 700 }
                    : undefined
                }
              >
                <span aria-hidden="true">%</span>
                <span>{t('sales.create_sales_order_page.s42', "ضريبة")}{taxRate > 0 ? ` ${taxRate}%` : ''}</span>
              </button>
              <button
                type="button"
                className="purchase-prototype-quick-action"
                title={t('sales.create_sales_order_page.s43', "إضافة خصم")}
                onClick={() => setActiveQuickAction((curr) => (curr === 'discount' ? null : 'discount'))}
                style={
                  discountValue > 0
                    ? { borderColor: '#16a34a', color: '#15803d', backgroundColor: '#f0fdf4', fontWeight: 700 }
                    : undefined
                }
              >
                <span>{t('sales.create_sales_order_page.s44', "خصم")}{discountValue > 0 ? (discountMode === 'percent' ? ` ${discountValue}%` : ` ${discountValue}`) : ''}</span>
              </button>
            </div>
          </div>

          {/* Quick Action Popovers */}
          {activeQuickAction === 'tax' && (
            <div className="purchase-prototype-popover" role="dialog" style={{ marginBottom: '12px' }}>
              <div className="purchase-prototype-popover-row">
                <button
                  type="button"
                  className={`purchase-prototype-popover-option ${taxRate === 0 ? 'active' : ''}`}
                  onClick={() => {
                    setTaxRate(0);
                    setActiveQuickAction(null);
                  }}
                  style={taxRate === 0 ? { backgroundColor: '#e0e7ff', borderColor: '#4338ca', color: '#3730a3', fontWeight: 700 } : undefined}
                >
                  {t('sales.create_sales_order_page.s45', "بدون ضريبة")}
                </button>
                <button
                  type="button"
                  className={`purchase-prototype-popover-option ${taxRate === 14 ? 'active' : ''}`}
                  onClick={() => {
                    setTaxRate(14);
                    setActiveQuickAction(null);
                  }}
                  style={taxRate === 14 ? { backgroundColor: '#e0e7ff', borderColor: '#4338ca', color: '#3730a3', fontWeight: 700 } : undefined}
                >
                  {t('sales.create_sales_order_page.s46', "14% (قيمة مضافة قياسية)")}
                </button>
                <button
                  type="button"
                  className={`purchase-prototype-popover-option ${taxRate === 15 ? 'active' : ''}`}
                  onClick={() => {
                    setTaxRate(15);
                    setActiveQuickAction(null);
                  }}
                  style={taxRate === 15 ? { backgroundColor: '#e0e7ff', borderColor: '#4338ca', color: '#3730a3', fontWeight: 700 } : undefined}
                >
                  {t('sales.create_sales_order_page.s47', "15% (الضريبة الخليجية)")}
                </button>
              </div>
            </div>
          )}

          {activeQuickAction === 'discount' && (
            <div className="purchase-prototype-popover" role="dialog" style={{ marginBottom: '12px' }}>
              <div className="purchase-prototype-popover-row" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  value={discountMode}
                  onChange={(e) => setDiscountMode(e.target.value as 'percent' | 'value')}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                >
                  <option value="value">{t('sales.create_sales_order_page.s48', "مبلغ ثابت (ج.م)")}</option>
                  <option value="percent">{t('sales.create_sales_order_page.s49', "نسبة مئوية (%)")}</option>
                </select>
                <input
                  type="number"
                  min="0"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(Number(e.target.value) || 0)}
                  placeholder={t('sales.create_sales_order_page.s50', "قيمة الخصم...")}
                  style={{ width: '120px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', textAlign: 'center' }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setActiveQuickAction(null)}
                  style={{ height: '32px', fontSize: '12px' }}
                >
                  {t('sales.create_sales_order_page.s51', "تطبيق")}
                </Button>
              </div>
            </div>
          )}

          {/* Desktop Items Table with Shaded Header */}
          <div className="document-line-items-table-wrap">
            <table className="document-line-items-table">
              <thead>
                <tr>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-product" style={{ width: '32%', textAlign: 'right' }}>{t('sales.create_sales_order_page.s52', "الصنف")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-category" style={{ width: '12%', textAlign: 'center' }}>{t('sales.create_sales_order_page.s53', "الوحدة")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-warehouse" style={{ width: '12%', textAlign: 'center' }}>{t('sales.create_sales_order_page.s54', "رصيد المخزن")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-qty" style={{ width: '10%', textAlign: 'center' }}>{t('sales.create_sales_order_page.s55', "الكمية")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-price" style={{ width: '12%', textAlign: 'center' }}>{t('sales.create_sales_order_page.s56', "السعر")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-price" style={{ width: '10%', textAlign: 'center' }}>{t('sales.create_sales_order_page.s57', "الخصم")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-amount" style={{ width: '12%', textAlign: 'center' }}>{t('sales.create_sales_order_page.s58', "المبلغ")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-actions" style={{ width: '5%', textAlign: 'center' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((line) => (
                  <tr key={line.id}>
                    {/* Item Name */}
                    <td className="purchase-prototype-table-cell purchase-prototype-table-cell-item">
                      <SearchableCombobox
                        inline
                        className="purchase-prototype-inline-combobox"
                        inputClassName="purchase-prototype-field-input purchase-prototype-combobox-input purchase-prototype-combobox-input-inline"
                        placeholder={t('sales.create_sales_order_page.s59', "ابحث عن صنف بالاسم أو الباركود...")}
                        value={line.productName}
                        onChange={(value) => {
                          handleUpdateLine(line.id, 'productName', value);
                          schedulePickerAvailabilityRefresh(value);
                        }}
                        options={productOptions}
                        getLabel={(p) => p.name}
                        getMeta={(p) => {
                          // INV-SALES-ORDER-RESERVED-STOCK-DISPLAY: the
                          // suggestion shows ONLY the reserved-aware
                          // availability in the selected warehouse.
                          // The catalog stock (p.stock) ignores
                          // reservations — it showed "رصيد: 10" for a
                          // product whose 10 units were already
                          // reserved. Unknown until the read returns:
                          // no stock segment at all, never a number
                          // from another source.
                          const avail = availabilityByProduct[p.rawId];
                          return [p.barcode, p.price > 0 ? `${formatCurrency(p.price)}` : undefined, avail === undefined ? undefined : `رصيد: ${avail}`].filter(Boolean).join(' · ');
                        }}
                        search={(p, query) =>
                          matchesArabic(p.name, query) ||
                          (p.barcode ? p.barcode.includes(query) : false) ||
                          (p.sku ? p.sku.toLowerCase().includes(query.toLowerCase()) : false)
                        }
                        onSelect={(option) => handleProductSelect(line.id, option)}
                        onOpenChange={(open) => {
                          if (open) schedulePickerAvailabilityRefresh(line.productName);
                        }}
                        showDropdownOnEmpty={true}
                        emptyLabel={t('sales.create_sales_order_page.s60', "صنف جديد (يمكنك المتابعة بالاسم المدخل)")}
                      />
                    </td>

                    {/* Unit */}
                    <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                      <input
                        className="purchase-prototype-table-input"
                        type="text"
                        placeholder={t('sales.create_sales_order_page.s61', "الوحدة...")}
                        value={line.unitName || ''}
                        onChange={(e) => handleUpdateLine(line.id, 'unitName', e.target.value)}
                        style={{ textAlign: 'center' }}
                      />
                    </td>

                    {/* Stock on hand */}
                    <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                      <span
                        className="nav-pill"
                        style={{
                          fontSize: '0.72rem',
                          padding: '2px 8px',
                          fontWeight: 700,
                          backgroundColor: (line.stockOnHand ?? 0) > 0 ? '#f0fdf4' : '#fef2f2',
                          color: (line.stockOnHand ?? 0) > 0 ? '#15803d' : '#b91c1c',
                          borderColor: (line.stockOnHand ?? 0) > 0 ? '#bbf7d0' : '#fecaca',
                        }}
                      >
                        {line.stockOnHand ?? 0} {t('sales.create_sales_order_page.s62', "متاح")}
                      </span>
                    </td>

                    {/* Quantity */}
                    <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                      <input
                        className="purchase-prototype-table-input"
                        type="number"
                        min="1"
                        step="1"
                        value={line.quantity}
                        onChange={(e) => handleUpdateLine(line.id, 'quantity', Math.max(1, Number(e.target.value) || 1))}
                        style={{ textAlign: 'center', fontWeight: 600 }}
                      />
                    </td>

                    {/* Price */}
                    <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                      <input
                        className="purchase-prototype-table-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) => handleUpdateLine(line.id, 'unitPrice', Math.max(0, Number(e.target.value) || 0))}
                        style={{ textAlign: 'center', fontWeight: 600 }}
                      />
                    </td>

                    {/* Line Discount */}
                    <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                      <input
                        className="purchase-prototype-table-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.discount || 0}
                        onChange={(e) => handleUpdateLine(line.id, 'discount', Math.max(0, Number(e.target.value) || 0))}
                        style={{ textAlign: 'center', color: '#dc2626' }}
                      />
                    </td>

                    {/* Line Total */}
                    <td className="line-total" style={{ textAlign: 'center', fontWeight: 700, color: '#170e5e' }}>
                      {formatCurrencyWithSymbol(line.total || 0, currency)}
                    </td>

                    {/* Delete Action */}
                    <td className="purchase-prototype-table-cell purchase-prototype-table-cell-actions" style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="document-row-delete purchase-prototype-row-delete"
                        onClick={() => handleRemoveItem(line.id)}
                        disabled={items.length === 1}
                        title={t('sales.create_sales_order_page.s63', "حذف هذا الصنف")}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bottom Dashed Actions */}
          <div className="document-line-items-actions" style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <Button type="button" variant="dashedAction" onClick={handleAddItem}>
              <span aria-hidden="true">+</span>
              <span>{t('sales.create_sales_order_page.s64', "إضافة صنف")}</span>
            </Button>
            <Button type="button" variant="dashedAction" onClick={handleBarcodeScan}>
              <span aria-hidden="true" className="purchase-prototype-scan-icon">
                <svg viewBox="0 0 16 16" role="img" focusable="false" aria-hidden="true" width="14" height="14">
                  <path d="M3 4.2V3.1A.6.6 0 0 1 3.6 2.5h1.1M11.3 2.5h1.1a.6.6 0 0 1 .6.6v1.1M13 11.8v1.1a.6.6 0 0 1-.6.6h-1.1M4.7 13.5H3.6a.6.6 0 0 1-.6-.6v-1.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M5.1 5.2v5.6M7 5.2v5.6M9 5.2v5.6M10.9 5.2v5.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </span>
              <span>{t('sales.create_sales_order_page.s65', "مسح باركود")}</span>
            </Button>
            <Button
              type="button"
              variant="dashedAction"
              onClick={() => {
                const name = window.prompt(t('sales.create_sales_order_page.s66', "أدخل اسم المنتج الجديد:"));
                if (name && name.trim()) {
                  setItems((prev) => [
                    ...prev,
                    {
                      id: Date.now() + Math.random(),
                      productId: 0,
                      productName: name.trim(),
                      unitName: t('sales.create_sales_order_page.s67', "قطعة"),
                      quantity: 1,
                      unitPrice: 0,
                      total: 0,
                      discount: 0,
                      stockOnHand: 0,
                      warehouse: t('sales.create_sales_order_page.s68', "المستودع الرئيسي"),
                    },
                  ]);
                }
              }}
            >
              <span aria-hidden="true">+</span>
              <span>{t('sales.create_sales_order_page.s69', "منتج جديد")}</span>
            </Button>
          </div>
        </section>

        {/* Section 4: Terms & Conditions */}
        <section className="document-prototype-section" style={{ marginTop: '12px' }}>
          <h3 className="document-prototype-section-title">{t('sales.create_sales_order_page.s70', "الشروط والأحكام")}</h3>
          <textarea
            className="purchase-prototype-notes-textarea"
            rows={3}
            value={termsConditions}
            onChange={(e) => setTermsConditions(e.target.value)}
            placeholder={t('sales.create_sales_order_page.s71', "الشروط والأحكام الخاصة بحجز البضاعة وسداد القيمة...")}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
        </section>

        {/* Section 5: Notes & Totals (60/40 Split) */}
        <section className="document-prototype-bottom-grid" style={{ marginTop: '12px' }}>
          {/* Notes Card (60%) */}
          <div className="document-prototype-section">
            <h3 className="document-prototype-section-title">{t('sales.create_sales_order_page.s72', "ملاحظات")}</h3>
            <textarea
              className="purchase-prototype-notes-textarea"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('sales.create_sales_order_page.s73', "ملاحظات إضافية للتسليم أو العميل...")}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          {/* Totals Card (40%) */}
          <div className="document-prototype-section document-totals-card">
            <h3 className="document-prototype-section-title">{t('sales.create_sales_order_page.s74', "الإجماليات")}</h3>
            <div className="document-totals-panel">
              <div>
                <span>{t('sales.create_sales_order_page.s75', "الإجمالي الفرعي:")}</span>
                <strong>{formatCurrencyWithSymbol(subtotal, currency)}</strong>
              </div>
              {totalDiscount > 0 && (
                <div style={{ color: '#dc2626' }}>
                  <span>{t('sales.create_sales_order_page.s76', "الخصم:")}</span>
                  <strong>- {formatCurrencyWithSymbol(totalDiscount, currency)}</strong>
                </div>
              )}
              <div>
                <span>{t('sales.create_sales_order_page.s77', "الضريبة (")}{taxRate}%):</span>
                <strong>{formatCurrencyWithSymbol(taxAmount, currency)}</strong>
              </div>
              <div className="document-total-grand" style={{ borderTop: '2px solid #e2e8f0', paddingTop: '8px', marginTop: '6px' }}>
                <span>{t('sales.create_sales_order_page.s78', "الصافي المطلوب:")}</span>
                <strong>{formatCurrencyWithSymbol(totalAmount, currency)}</strong>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
