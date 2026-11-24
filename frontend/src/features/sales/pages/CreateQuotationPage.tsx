import { useTranslation } from 'react-i18next';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateQuotationForm, type CreateQuotationPayload } from '../hooks/useCreateQuotationForm';
import { useQuotationAvailability } from '../hooks/useQuotationAvailability';
import { useProductsQuery } from '@/shared/hooks/use-catalog-queries';
import { useAppToolbar } from '@/stores/toolbar-store';
import { toast } from '@/shared/components/system-alert';
import { useFormDraft } from '@/shared/hooks/use-form-draft';
import { DraftRestoredBanner } from '@/shared/components/DraftRestoredBanner';
import { matchesArabic, scoreArabicSearchRelevance } from '@/lib/arabic-normalization';
import { addDaysLocalDateKey, todayLocalDateKey } from '@/lib/format';
import type { Product } from '@/types/domain';
import type { QuotationFormItem } from './create-quotation-page/quotation-form-item';
import { CreateQuotationPageHeader } from './create-quotation-page/create-quotation-page-header';
import { CreateQuotationPageCustomer } from './create-quotation-page/create-quotation-page-customer';
import { CreateQuotationPageItems } from './create-quotation-page/create-quotation-page-items';
import { CreateQuotationPageSummary } from './create-quotation-page/create-quotation-page-summary';


export function CreateQuotationPage() {
  const { t } = useTranslation();
  useAppToolbar([
    { label: 'المبيعات', to: '/sales' },
    { label: 'عروض الأسعار', to: '/quotations' },
    { label: 'عرض سعر جديد' },
  ]);

  const navigate = useNavigate();

  // Customer & Header State
  // Customer ids are STRINGS end to end (Customer.id: string; BIGINT ids
  // arrive from the API as strings). Keep the selected id a string so the
  // lookup below can match it; convert to a number only at the payload
  // boundary, where the API expects customerId: number | null.
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [quotationDate, setQuotationDate] = useState(todayLocalDateKey());
  const [validUntil, setValidUntil] = useState(
    addDaysLocalDateKey(15)
  );
  const [currency, setCurrency] = useState('EGP');

  // Quick Action State
  const [activeQuickAction, setActiveQuickAction] = useState<'tax' | 'discount' | null>(null);
  const [taxRate, setTaxRate] = useState<number>(0);
  const [discountMode, setDiscountMode] = useState<'percent' | 'value'>('value');
  const [discountValue, setDiscountValue] = useState<number>(0);

  // Notes & Terms
  const [notes, setNotes] = useState('');
  const [termsConditions, setTermsConditions] = useState(
    '1. عرض السعر ساري لمدة 15 يوماً من تاريخ الإصدار.\n2. الأسعار شاملة ضريبة القيمة المضافة ما لم يذكر خلاف ذلك.\n3. يتم تأكيد التوريد فور استلام أمر شراء معتمد أو دفعة مقدمة.'
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
  const [items, setItems] = useState<QuotationFormItem[]>([
    {
      id: Date.now(),
      productId: 0,
      productName: '',
      product_name: '',
      unitName: 'قطعة',
      quantity: 1,
      unitPrice: 0,
      unit_price: 0,
      discount: 0,
      tax_rate: 0,
      tax_amount: 0,
      total: 0,
      stockOnHand: 0,
    },
  ]);

  // Feature Hook for Data Access
  const { data: catalogProducts = [] } = useProductsQuery();
  const {
    customers,
    createQuotation,
    isSubmitting,
  } = useCreateQuotationForm({
    onSuccess: () => {
      clearDraft();
      navigate('/quotations');
    },
  });

  const productOptions = useMemo(() => {
    return (catalogProducts || []).map((p: Product) => ({
      id: String(p.id),
      rawId: Number(p.id),
      name: p.name || '',
      barcode: p.barcode || '',
      sku: p.sku || '',
      price: Number((p as any).retailPrice ?? (p as any).wholesalePrice ?? (p as any).price ?? 0),
      costPrice: Number(p.costPrice ?? 0),
      unit: p.units?.[0]?.name || (p as any).unit || 'قطعة',
      stock: Number((p as any).stock ?? (p as any).quantity ?? 0),
      raw: p,
    }));
  }, [catalogProducts]);

  // INV-QUOTATION-RESERVED-STOCK-DISPLAY: the picker suggestion
  // shows ONLY the reserved-aware availability — never the catalog
  // stock (p.stock = products.stock_qty, on-hand before reservations,
  // in no warehouse in particular). A quotation has no warehouse, so
  // the read is the GLOBAL availability (locationId null): the backend
  // returns availableAtLocation = globalAvailable =
  // stock_qty - reserved_qty in that case, exactly the arithmetic the
  // approval check enforces when no warehouse is chosen. Availability
  // is fetched for the options the dropdown is about to show (same
  // predicate and 8-option cap as SearchableCombobox), when the
  // dropdown opens and, debounced, while the user types. The read
  // itself lives in useQuotationAvailability — page files must go
  // through feature hooks instead of calling the api layer directly
  // (INV-CI-I10-PAGE-COMPOSITION).
  const { availabilityByProduct, refreshAvailability } = useQuotationAvailability();

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

  // Whenever a line's product changes, re-read the availability of
  // every line product — the same read the approval check enforces —
  // and show it on the line.
  const lineProductIdsKey = items
    .map((it) => it.productId)
    .filter((id): id is number => id !== undefined && id > 0)
    .join(',');
  useEffect(() => {
    const ids = items
      .map((it) => it.productId)
      .filter((id): id is number => id !== undefined && id > 0);
    if (ids.length > 0) void refreshAvailability(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineProductIdsKey, refreshAvailability]);

  useEffect(() => {
    setItems((prev) => {
      let changed = false;
      const next = prev.map((it) => {
        const avail =
          it.productId !== undefined && it.productId > 0
            ? availabilityByProduct[it.productId]
            : undefined;
        if (avail === undefined || avail === it.stockOnHand) return it;
        changed = true;
        return { ...it, stockOnHand: avail };
      });
      return changed ? next : prev;
    });
  }, [availabilityByProduct]);

  // Draft Management
  const formData = useMemo(
    () => ({
      selectedCustomerId,
      customerName,
      customerPhone,
      customerAddress,
      quotationDate,
      validUntil,
      currency,
      taxRate,
      discountMode,
      discountValue,
      notes,
      termsConditions,
      items,
    }),
    [
      selectedCustomerId,
      customerName,
      customerPhone,
      customerAddress,
      quotationDate,
      validUntil,
      currency,
      taxRate,
      discountMode,
      discountValue,
      notes,
      termsConditions,
      items,
    ]
  );

  const { clearDraft, isDraftRestored, dismissRestoredNotice } = useFormDraft({
    key: 'draft_create_quotation_form',
    data: formData,
    isEmpty: (d) => !d.customerName?.trim() && !d.items?.some((it: any) => Boolean(it.productName?.trim() || it.product_name?.trim())),
    onRestore: (restored) => {
      if (restored.selectedCustomerId !== undefined) {
        // Drafts saved before the string-id fix may hold a number; normalise.
        setSelectedCustomerId(restored.selectedCustomerId == null ? null : String(restored.selectedCustomerId));
      }
      if (restored.customerName) setCustomerName(restored.customerName);
      if (restored.customerPhone) setCustomerPhone(restored.customerPhone);
      if (restored.customerAddress) setCustomerAddress(restored.customerAddress);
      if (restored.quotationDate) setQuotationDate(restored.quotationDate);
      if (restored.validUntil) setValidUntil(restored.validUntil);
      if (restored.currency) setCurrency(restored.currency);
      if (restored.taxRate !== undefined) setTaxRate(restored.taxRate);
      if (restored.discountMode) setDiscountMode(restored.discountMode);
      if (restored.discountValue !== undefined) setDiscountValue(restored.discountValue);
      if (restored.notes) setNotes(restored.notes);
      if (restored.termsConditions) setTermsConditions(restored.termsConditions);
      if (restored.items && Array.isArray(restored.items)) {
        // INV-QUOTATION-RESERVED-STOCK-DISPLAY: a saved stockOnHand
        // is stale the moment another order reserves the stock — never
        // show the persisted number as if it were live. A restored
        // line starts at 0 (like a fresh line) until the reserved-aware
        // read returns and the sync effect fills it in.
        setItems(restored.items.map((it: any) => ({ ...it, stockOnHand: 0 })));
      }
    },
  });

  // Calculations
  const calculations = useMemo(() => {
    let rawSubtotal = 0;
    let itemDiscountsTotal = 0;
    let itemTaxTotal = 0;

    items.forEach((item) => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice ?? item.unit_price) || 0;
      const disc = Number(item.discount) || 0;
      const lineSubtotal = qty * price;
      const lineNet = Math.max(0, lineSubtotal - disc);
      const lineTaxRate = Number(item.tax_rate) || 0;
      const lineTax = lineNet * (lineTaxRate / 100);

      rawSubtotal += lineSubtotal;
      itemDiscountsTotal += disc;
      itemTaxTotal += lineTax;
    });

    // Global discount
    let totalDiscount = itemDiscountsTotal;
    if (discountValue > 0) {
      if (discountMode === 'percent') {
        totalDiscount += (rawSubtotal - itemDiscountsTotal) * (discountValue / 100);
      } else {
        totalDiscount += discountValue;
      }
    }

    const netTaxable = Math.max(0, rawSubtotal - totalDiscount);
    let finalTaxTotal = itemTaxTotal;
    if (taxRate > 0) {
      finalTaxTotal += netTaxable * (taxRate / 100);
    }

    const grandTotal = netTaxable + finalTaxTotal;

    return {
      rawSubtotal,
      totalDiscount,
      netTaxable,
      taxTotal: finalTaxTotal,
      grandTotal,
    };
  }, [items, discountValue, discountMode, taxRate]);

  // Handlers
  const handleCustomerSelect = (customerIdStr: string) => {
    if (!customerIdStr) {
      // "عميل نقدي / اختيار من القائمة..." — walk-in customer, no link.
      setSelectedCustomerId(null);
      return;
    }
    setSelectedCustomerId(customerIdStr);
    // Compare as strings: Customer.id is a string, so comparing against
    // Number(customerIdStr) could never match and the pick silently
    // dropped the name/phone/address (the I3-D4 live defect).
    const customer = customers.find((c: any) => String(c.id) === customerIdStr);
    if (customer) {
      setCustomerName(customer.name || '');
      setCustomerPhone(customer.phone || '');
      setCustomerAddress(customer.address || '');
    }
  };

  const handleAddItem = (type: 'product' | 'service' = 'product') => {
    setItems((prev) => [
      ...prev,
      {
        id: Date.now(),
        productId: 0,
        productName: '',
        product_name: '',
        unitName: type === 'service' ? 'خدمة' : 'قطعة',
        quantity: 1,
        unitPrice: 0,
        unit_price: 0,
        discount: 0,
        tax_rate: 0,
        tax_amount: 0,
        total: 0,
        stockOnHand: 0,
      },
    ]);
  };

  const handleUpdateItem = (id: number, updates: Partial<QuotationFormItem>) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, ...updates };

        // Keep synced
        if (updates.productName !== undefined) updated.product_name = updates.productName;
        if (updates.product_name !== undefined) updated.productName = updates.product_name;
        if (updates.unitPrice !== undefined) updated.unit_price = updates.unitPrice;
        if (updates.unit_price !== undefined) updated.unitPrice = updates.unit_price;

        const qty = Number(updated.quantity) || 0;
        const price = Number(updated.unitPrice ?? updated.unit_price) || 0;
        const disc = Number(updated.discount) || 0;
        const lineSub = qty * price;
        const lineNet = Math.max(0, lineSub - disc);
        const lineTax = lineNet * ((Number(updated.tax_rate) || 0) / 100);

        updated.tax_amount = lineTax;
        updated.total = lineNet + lineTax;
        return updated;
      })
    );
  };

  const handleRemoveItem = (id: number) => {
    if (items.length <= 1) {
      toast.warning('يجب أن يحتوي عرض السعر على بند واحد على الأقل');
      return;
    }
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleProductSelect = (itemId: number, option: any) => {
    // INV-QUOTATION-RESERVED-STOCK-DISPLAY: the line starts at the
    // known reserved-aware availability (0 until the read returns),
    // never the catalog stock — then re-read it live.
    const knownAvailability = availabilityByProduct[option.rawId];
    handleUpdateItem(itemId, {
      productId: option.rawId,
      productName: option.name,
      product_name: option.name,
      unitPrice: option.price,
      unit_price: option.price,
      unitName: option.unit || 'قطعة',
      stockOnHand: knownAvailability ?? 0,
      barcode: option.barcode || '',
    });
    void refreshAvailability([option.rawId]);
  };

  // I10-A (R8): the two submit intents are different documents.
  // "حفظ كمسودة" keeps the quotation a draft; "اعتماد ..." issues
  // it (status 'sent'). Previously both buttons called this with no
  // argument and the payload carried no status, so the backend
  // hardcoded 'draft' and the approve button silently produced a
  // draft (live QUO-183760).
  const handleSubmit = (approve: boolean) => {
    if (!customerName.trim()) {
      toast.error('يرجى تحديد اسم العميل لإصدار عرض السعر');
      return;
    }

    const validItems = items.filter(
      (item) => (item.productName?.trim() || item.product_name?.trim()) && Number(item.quantity) > 0
    );

    if (validItems.length === 0) {
      toast.error('يرجى إضافة بند واحد على الأقل يحتوي على اسم وكمية صحيحة');
      return;
    }

    const payload: CreateQuotationPayload = {
      customerId: selectedCustomerId ? Number(selectedCustomerId) : null,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      customerAddress: customerAddress.trim() || undefined,
      validUntil: validUntil || undefined,
      status: approve ? 'sent' : 'draft',
      subtotal: calculations.rawSubtotal,
      discountAmount: calculations.totalDiscount,
      taxAmount: calculations.taxTotal,
      totalAmount: calculations.grandTotal,
      notes: notes.trim() || undefined,
      termsConditions: termsConditions.trim() || undefined,
      items: validItems.map((item) => ({
        productId: item.productId || undefined,
        productName: (item.productName || item.product_name || '').trim(),
        unitName: item.unitName || 'قطعة',
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unitPrice ?? item.unit_price) || 0,
        discount: Number(item.discount) || 0,
        tax_rate: Number(item.tax_rate) || 0,
        tax_amount: Number(item.tax_amount) || 0,
        total: Number(item.total) || 0,
        notes: item.notes || undefined,
      })),
    };

    createQuotation(payload);
  };

  return (
    <div className="page-stack page-shell create-quotation-workspace" dir="rtl">
      <DraftRestoredBanner show={isDraftRestored} onClear={clearDraft} onDismiss={dismissRestoredNotice} />

      <div className="document-prototype-column" style={{ maxWidth: '1280px', margin: '0 auto', width: '100%', paddingBottom: '40px' }}>
        <CreateQuotationPageHeader
          t={t}
          calculations={calculations}
          currency={currency}
          clearDraft={clearDraft}
          navigate={navigate}
          handleSubmit={handleSubmit}
          isSubmitting={isSubmitting}
        />

        <CreateQuotationPageCustomer
          t={t}
          selectedCustomerId={selectedCustomerId}
          handleCustomerSelect={handleCustomerSelect}
          customers={customers}
          customerName={customerName}
          setCustomerName={setCustomerName}
          setSelectedCustomerId={setSelectedCustomerId}
          customerPhone={customerPhone}
          setCustomerPhone={setCustomerPhone}
          customerAddress={customerAddress}
          setCustomerAddress={setCustomerAddress}
          quotationDate={quotationDate}
          setQuotationDate={setQuotationDate}
          validUntil={validUntil}
          setValidUntil={setValidUntil}
          currency={currency}
          setCurrency={setCurrency}
        />

        <CreateQuotationPageItems
          t={t}
          handleAddItem={handleAddItem}
          activeQuickAction={activeQuickAction}
          setActiveQuickAction={setActiveQuickAction}
          setTaxRate={setTaxRate}
          taxRate={taxRate}
          setDiscountMode={setDiscountMode}
          discountMode={discountMode}
          discountValue={discountValue}
          setDiscountValue={setDiscountValue}
          currency={currency}
          items={items}
          handleUpdateItem={handleUpdateItem}
          schedulePickerAvailabilityRefresh={schedulePickerAvailabilityRefresh}
          productOptions={productOptions}
          availabilityByProduct={availabilityByProduct}
          handleProductSelect={handleProductSelect}
          handleRemoveItem={handleRemoveItem}
        />

        <CreateQuotationPageSummary
          t={t}
          notes={notes}
          setNotes={setNotes}
          termsConditions={termsConditions}
          setTermsConditions={setTermsConditions}
          handleFileUpload={handleFileUpload}
          attachments={attachments}
          calculations={calculations}
          currency={currency}
          handleSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          clearDraft={clearDraft}
          navigate={navigate}
        />
      </div>
    </div>
  );
}

export default CreateQuotationPage;
