import { useTranslation } from 'react-i18next';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateSalesOrderForm } from '../hooks/useCreateSalesOrderForm';
import { useSalesOrderWarehouse } from '../hooks/useSalesOrderWarehouse';
import { useProductsQuery, useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { resolveSalesOrderBarcodeScan } from '../lib/sales-order-barcode-scan';
import { useAppToolbar } from '@/stores/toolbar-store';
import { toast } from '@/shared/components/system-alert';
import { useFormDraft } from '@/shared/hooks/use-form-draft';
import { matchesArabic, scoreArabicSearchRelevance } from '@/lib/arabic-normalization';
import { addDaysLocalDateKey, todayLocalDateKey } from '@/lib/format';
import type { Product } from '@/types/domain';
import type { SalesOrderFormItem } from './create-sales-order-page/create-sales-order-page-shared';
import { CreateSalesOrderPageHeader } from './create-sales-order-page/create-sales-order-page-header';
import { CreateSalesOrderPageBasicInfo } from './create-sales-order-page/create-sales-order-page-basic-info';
import { CreateSalesOrderPageWarehouse } from './create-sales-order-page/create-sales-order-page-warehouse';
import { CreateSalesOrderPageItems } from './create-sales-order-page/create-sales-order-page-items';
import { CreateSalesOrderPageTerms } from './create-sales-order-page/create-sales-order-page-terms';
import { CreateSalesOrderPageTotals } from './create-sales-order-page/create-sales-order-page-totals';

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
  const [orderDate, setOrderDate] = useState(todayLocalDateKey());
  const [deliveryDate, setDeliveryDate] = useState(
    addDaysLocalDateKey(3)
  );
  const [reservationExpiresAt, setReservationExpiresAt] = useState(
    addDaysLocalDateKey(7)
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
  const { data: settings } = useSettingsQuery();
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
      if (!q) {
        return matched.slice(0, 20).map((p) => p.rawId);
      }
      return matched
        .map((p, idx) => ({
          p,
          idx,
          score: scoreArabicSearchRelevance(p.name, q, [p.barcode, p.sku]) || 100,
        }))
        .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx))
        .slice(0, 20)
        .map((entry) => entry.p.rawId);
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
    setOrderDate(todayLocalDateKey());
    setDeliveryDate(addDaysLocalDateKey(3));
    setReservationExpiresAt(addDaysLocalDateKey(7));
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
    const result = barcode ? resolveSalesOrderBarcodeScan({ scannedCode: barcode, catalogProducts, productOptions, settings }) : null;
    if (!result) return;
    if (result.status === 'error') {
      toast.warning(result.message);
      return;
    }
    const { option: found, quantity, unitName, total } = result;
    setItems((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(), productId: found.rawId, productName: found.name, unitName,
        quantity, unitPrice: found.price, discount: 0, total,
        // INV-SALES-ORDER-WAREHOUSE-SELECTION: selected-warehouse availability, never global stock.
        stockOnHand: availabilityByProduct[found.rawId] ?? 0, warehouse: 'المستودع الرئيسي',
      },
    ]);
    void refreshAvailability([found.rawId]);
    toast.success(`تمت إضافة الصنف: ${found.name}`);
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
        <CreateSalesOrderPageHeader
          t={t}
          navigate={navigate}
          totalAmount={totalAmount}
          currency={currency}
          handleSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          isDraftRestored={isDraftRestored}
          resetForm={resetForm}
          dismissRestoredNotice={dismissRestoredNotice}
        />

        <CreateSalesOrderPageBasicInfo
          t={t}
          handleFileUpload={handleFileUpload}
          attachments={attachments}
          customerName={customerName}
          setCustomerName={setCustomerName}
          customers={customers}
          setSelectedCustomerId={setSelectedCustomerId}
          setCustomerPhone={setCustomerPhone}
          setCustomerAddress={setCustomerAddress}
          customerOptions={customerOptions}
          customerPhone={customerPhone}
          paymentType={paymentType}
          setPaymentType={setPaymentType}
          orderDate={orderDate}
          setOrderDate={setOrderDate}
          deliveryDate={deliveryDate}
          setDeliveryDate={setDeliveryDate}
          currency={currency}
          setCurrency={setCurrency}
        />

        <CreateSalesOrderPageWarehouse
          t={t}
          reservationExpiresAt={reservationExpiresAt}
          setReservationExpiresAt={setReservationExpiresAt}
          customerAddress={customerAddress}
          setCustomerAddress={setCustomerAddress}
          selectedWarehouseId={selectedWarehouseId}
          selectWarehouse={selectWarehouse}
          warehouseOptions={warehouseOptions}
          autoReserve={autoReserve}
          setAutoReserve={setAutoReserve}
        />

        <CreateSalesOrderPageItems
          t={t}
          items={items}
          handleAddItem={handleAddItem}
          handleAddServiceLine={handleAddServiceLine}
          setActiveQuickAction={setActiveQuickAction}
          taxRate={taxRate}
          discountValue={discountValue}
          discountMode={discountMode}
          activeQuickAction={activeQuickAction}
          setTaxRate={setTaxRate}
          setDiscountMode={setDiscountMode}
          setDiscountValue={setDiscountValue}
          handleUpdateLine={handleUpdateLine}
          schedulePickerAvailabilityRefresh={schedulePickerAvailabilityRefresh}
          productOptions={productOptions}
          availabilityByProduct={availabilityByProduct}
          handleProductSelect={handleProductSelect}
          currency={currency}
          handleRemoveItem={handleRemoveItem}
          handleBarcodeScan={handleBarcodeScan}
          setItems={setItems}
        />

        <CreateSalesOrderPageTerms
          t={t}
          termsConditions={termsConditions}
          setTermsConditions={setTermsConditions}
        />

        <CreateSalesOrderPageTotals
          t={t}
          notes={notes}
          setNotes={setNotes}
          subtotal={subtotal}
          currency={currency}
          totalDiscount={totalDiscount}
          taxRate={taxRate}
          taxAmount={taxAmount}
          totalAmount={totalAmount}
        />
      </main>
    </div>
  );
}
