import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreatePurchaseOrderForm, type PurchaseOrderItem } from '../hooks/useCreatePurchaseOrderForm';
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

interface FormLineItem extends PurchaseOrderItem {
  id: number;
  category?: string;
  warehouse?: string;
}

export function CreatePurchaseOrderPage() {
  const { t } = useTranslation();
  useAppToolbar([
    { label: 'المشتريات والموردين', to: '/purchases' },
    { label: 'أوامر الشراء (PO)', to: '/purchases/orders' },
    { label: 'أمر شراء جديد' },
  ]);

  const navigate = useNavigate();

  // Header State
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [paymentType, setPaymentType] = useState<'cash' | 'credit'>('credit');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(
    new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [currency, setCurrency] = useState('EGP');
  const [warehouseName, setWarehouseName] = useState('المستودع الرئيسي');

  // Quick Action State
  const [activeQuickAction, setActiveQuickAction] = useState<'tax' | 'discount' | null>(null);
  const [taxRate, setTaxRate] = useState<number>(0);
  const [discountMode, setDiscountMode] = useState<'percent' | 'value'>('value');
  const [discountValue, setDiscountValue] = useState<number>(0);

  // Notes & Terms
  const [notes, setNotes] = useState('');
  const [termsConditions, setTermsConditions] = useState(
    '1. يتم تسليم البضاعة مطابقة للمواصفات والأوزان المحددة.\n2. يحق للطرف الأول فحص ومعاينة البضاعة ورفض غير المطابق منها.'
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
  const [items, setItems] = useState<FormLineItem[]>([
    { id: Date.now(), productId: undefined, productName: '', unitName: 'قطعة', quantity: 1, unitCost: 0, total: 0, discount: 0, warehouse: 'المستودع الرئيسي' },
  ]);

  const handleAddServiceLine = () => {
    setItems((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        productId: undefined,
        productName: 'خدمة توريد ونقل',
        unitName: 'خدمة',
        quantity: 1,
        unitCost: 0,
        total: 0,
        discount: 0,
        warehouse: 'لا يؤثر على المخزون',
      },
    ]);
  };

  const handleBarcodeScan = () => {
    const barcode = window.prompt('امسح أو أدخل الباركود:');
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
            unitCost: found.costPrice,
            total: found.costPrice,
            discount: 0,
            warehouse: warehouseName,
          },
        ]);
        toast.success(`تمت إضافة الصنف: ${found.name}`);
      } else {
        toast.warning('لم يتم العثور على صنف بهذا الباركود');
      }
    }
  };

  // Feature Hook for Data Access
  const {
    suppliers,
    products,
    createPurchaseOrder,
    saveDraftPurchaseOrder,
    isSubmitting,
  } = useCreatePurchaseOrderForm({
    onSuccess: () => {
      clearDraft();
      navigate('/purchases/orders');
    },
  });

  const supplierOptions = useMemo(() => {
    return (suppliers || []).map((s: any) => ({
      id: String(s.id),
      rawId: Number(s.id),
      name: s.name || '',
      phone: s.phone || '',
      code: s.code || '',
    }));
  }, [suppliers]);

  const productOptions = useMemo(() => {
    return (products || []).map((p: any) => ({
      id: String(p.id),
      rawId: Number(p.id),
      name: p.name || '',
      barcode: p.barcode || '',
      sku: p.sku || p.code || '',
      costPrice: Number(p.costPrice ?? p.cost_price ?? 0),
      unit: p.unit || 'قطعة',
      category: p.categoryName || p.category_name || '',
    }));
  }, [products]);

  // Calculations
  const subtotal = useMemo(() => {
    return items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.unitCost || 0), 0);
  }, [items]);

  const discountTotal = useMemo(() => {
    if (discountMode === 'percent') {
      return (subtotal * (Number(discountValue) || 0)) / 100;
    }
    return Number(discountValue) || 0;
  }, [subtotal, discountMode, discountValue]);

  const taxableAmount = Math.max(0, subtotal - discountTotal);
  const taxAmount = (taxableAmount * (Number(taxRate) || 0)) / 100;
  const totalAmount = Math.max(0, taxableAmount + taxAmount);

  // Draft Management
  const draftData = useMemo(() => ({
    selectedSupplierId,
    supplierName,
    supplierPhone,
    paymentType,
    orderDate,
    expectedDeliveryDate,
    currency,
    warehouseName,
    taxRate,
    discountMode,
    discountValue,
    notes,
    termsConditions,
    items,
  }), [
    selectedSupplierId,
    supplierName,
    supplierPhone,
    paymentType,
    orderDate,
    expectedDeliveryDate,
    currency,
    warehouseName,
    taxRate,
    discountMode,
    discountValue,
    notes,
    termsConditions,
    items,
  ]);

  const resetForm = () => {
    clearDraft();
    setSelectedSupplierId(null);
    setSupplierName('');
    setSupplierPhone('');
    setPaymentType('credit');
    setOrderDate(new Date().toISOString().split('T')[0]);
    setExpectedDeliveryDate(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
    setCurrency('EGP');
    setWarehouseName('المستودع الرئيسي');
    setTaxRate(0);
    setDiscountMode('value');
    setDiscountValue(0);
    setNotes('');
    setTermsConditions(
      '1. يتم تسليم البضاعة مطابقة للمواصفات والأوزان المحددة.\n2. يحق للطرف الأول فحص ومعاينة البضاعة ورفض غير المطابق منها.'
    );
    setItems([
      { id: Date.now(), productId: undefined, productName: '', unitName: 'قطعة', quantity: 1, unitCost: 0, total: 0, discount: 0, warehouse: 'المستودع الرئيسي' },
    ]);
  };

  const { clearDraft, isDraftRestored, dismissRestoredNotice } = useFormDraft({
    key: 'z_draft_purchase_order_unified',
    data: draftData,
    isEmpty: (d) => {
      const hasHeader = Boolean(d.selectedSupplierId || d.supplierName?.trim() || d.notes?.trim());
      const hasItems = Array.isArray(d.items) && d.items.some((it: any) => Boolean(it.productName?.trim() || it.unitCost > 0));
      return !hasHeader && !hasItems;
    },
    onRestore: (saved) => {
      if (saved.selectedSupplierId) setSelectedSupplierId(saved.selectedSupplierId);
      if (saved.supplierName) setSupplierName(saved.supplierName);
      if (saved.supplierPhone) setSupplierPhone(saved.supplierPhone);
      if (saved.paymentType) setPaymentType(saved.paymentType);
      if (saved.orderDate) setOrderDate(saved.orderDate);
      if (saved.expectedDeliveryDate) setExpectedDeliveryDate(saved.expectedDeliveryDate);
      if (saved.currency) setCurrency(saved.currency);
      if (saved.warehouseName) setWarehouseName(saved.warehouseName);
      if (typeof saved.taxRate === 'number') setTaxRate(saved.taxRate);
      if (saved.discountMode) setDiscountMode(saved.discountMode);
      if (typeof saved.discountValue === 'number') setDiscountValue(saved.discountValue);
      if (saved.notes) setNotes(saved.notes);
      if (saved.termsConditions) setTermsConditions(saved.termsConditions);
      if (Array.isArray(saved.items) && saved.items.length > 0) {
        setItems(saved.items);
      }
    },
  });

  // Line Item Handlers
  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        productId: undefined,
        productName: '',
        unitName: 'قطعة',
        quantity: 1,
        unitCost: 0,
        total: 0,
        discount: 0,
        warehouse: warehouseName,
      },
    ]);
  };

  const handleRemoveLine = (id: number) => {
    if (items.length <= 1) {
      toast.info('يجب أن يحتوي أمر الشراء على بند واحد على الأقل');
      return;
    }
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleProductSelect = (id: number, product: (typeof productOptions)[0]) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const qty = Number(it.quantity) || 1;
        const cost = Number(product.costPrice) || 0;
        return {
          ...it,
          productId: product.rawId,
          productName: product.name,
          unitCost: cost,
          unitName: product.unit || 'قطعة',
          category: product.category || '',
          total: qty * cost,
        };
      })
    );
  };

  const handleUpdateLine = (id: number, field: keyof FormLineItem, value: any) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const updated = { ...it, [field]: value };
        const qty = Number(updated.quantity) || 0;
        const cost = Number(updated.unitCost) || 0;
        updated.total = Math.max(0, qty * cost);
        return updated;
      })
    );
  };

  // Shared payload builder for both actions (INV-PURCHASE-ORDER-DRAFT-APPROVE):
  // "save as draft" and "approve" validate the same way and send the same
  // order; only the intent differs (the hook adds submitForApproval on
  // the approve path). Returns null when the form is not submittable.
  const buildPayload = () => {
    if (!supplierName.trim()) {
      toast.warning('يرجى تحديد اسم المورد');
      return null;
    }

    const validItems = items.filter((it) => it.productName.trim() && Number(it.quantity) > 0);
    if (!validItems.length) {
      toast.warning('يرجى إضافة صنف واحد على الأقل وتحديد كميته');
      return null;
    }

    return {
      supplierId: selectedSupplierId || undefined,
      supplierName: supplierName.trim(),
      supplierPhone: supplierPhone.trim() || undefined,
      warehouseName: warehouseName.trim() || undefined,
      expectedDeliveryDate: expectedDeliveryDate || undefined,
      subtotal,
      discountAmount: discountTotal,
      taxAmount,
      totalAmount,
      notes: notes.trim() || undefined,
      termsConditions: termsConditions.trim() || undefined,
      items: validItems.map((it) => ({
        productId: it.productId,
        productName: it.productName.trim(),
        unitName: it.unitName?.trim() || 'قطعة',
        quantity: Number(it.quantity),
        unitCost: Number(it.unitCost),
        taxRate: taxRate > 0 ? taxRate : undefined,
        discount: Number(it.discount || 0),
        total: Number(it.total),
      })),
    };
  };

  const handleSaveDraft = () => {
    const payload = buildPayload();
    if (payload) saveDraftPurchaseOrder(payload);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const payload = buildPayload();
    if (payload) createPurchaseOrder(payload);
  };

  return (
    <div className="purchase-prototype-theme-root" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '32px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        {/* Universal Document Header */}
        <PageHeader
          title={t('purchases.create_purchase_order_page.s0', "أمر شراء جديد")}
          onBack={() => navigate('/purchases/orders')}
          badge={
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span className="document-prototype-status-badge is-draft">{t('purchases.create_purchase_order_page.s1', "مسودة")}</span>
              <span className="nav-pill" style={{ fontWeight: 700, color: '#0f172a' }}>
                {t('purchases.create_purchase_order_page.s2', "الإجمالي:")} {formatCurrencyWithSymbol(totalAmount, currency)}
              </span>
            </div>
          }
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="secondary"
                type="button"
                className="purchase-prototype-toolbar-action purchase-prototype-toolbar-action-secondary"
                onClick={() => navigate('/purchases/orders')}
                style={{ color: 'var(--danger-color)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
              >
                <span>{t('purchases.create_purchase_order_page.s3', "إلغاء المسودة")}</span>
              </Button>
              <Button
                variant="secondary"
                type="button"
                className="purchase-prototype-toolbar-action purchase-prototype-toolbar-action-secondary"
                onClick={handleSaveDraft}
                disabled={isSubmitting}
              >
                <span>{t('purchases.create_purchase_order_page.s5', "حفظ كمسودة")}</span>
              </Button>
              <Button
                type="button"
                className="purchase-prototype-toolbar-action purchase-prototype-toolbar-action-primary"
                onClick={() => handleSubmit()}
                disabled={isSubmitting}
              >
                <span>{isSubmitting ? t('purchases.create_purchase_order_page.s6', "جارٍ الاعتماد...") : t('purchases.create_purchase_order_page.s7', "اعتماد أمر الشراء")}</span>
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
            <h3 className="document-prototype-section-title">{t('purchases.create_purchase_order_page.s8', "المعلومات الأساسية")}</h3>
            <div className="section-header-actions-group" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <label className="section-header-action-btn purchase-camera-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', margin: 0 }}>
                <input type="file" accept="image/*" capture="environment" onChange={handleFileUpload} style={{ display: 'none' }} />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span>{t('purchases.create_purchase_order_page.s9', "كاميرا")}</span>
              </label>
              <label className="section-header-action-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', margin: 0 }}>
                <input type="file" multiple onChange={handleFileUpload} style={{ display: 'none' }} />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                  <path d="M21 12.5 12.8 20.7a5 5 0 0 1-7.1-7.1L14.2 5.1a3.5 3.5 0 0 1 4.9 4.9L9.9 19.2" />
                </svg>
                <span>{t('purchases.create_purchase_order_page.s10', "إرفاق")}</span>
                {attachments.length > 0 && <span className="nav-pill" style={{ fontSize: '0.65rem', padding: '1px 4px', marginInlineStart: '2px' }}>{attachments.length}</span>}
              </label>
            </div>
          </div>

          <div className="purchase-prototype-form-grid">
            {/* Supplier */}
            <SearchableCombobox
              label={t('purchases.create_purchase_order_page.s11', "المورد *")}
              placeholder={t('purchases.create_purchase_order_page.s12', "ابحث عن مورد بالاسم أو الهاتف...")}
              value={supplierName}
              onChange={(value) => {
                setSupplierName(value);
                const found = suppliers.find((s: any) => s.name === value);
                if (found) {
                  setSelectedSupplierId(Number(found.id));
                  setSupplierPhone(found.phone || '');
                } else {
                  setSelectedSupplierId(null);
                }
              }}
              options={supplierOptions}
              search={(s, query) => matchesArabic(s.name, query) || (s.phone ? s.phone.includes(query) : false)}
              getLabel={(s) => s.name}
              getMeta={(s) => [s.code, s.phone].filter(Boolean).join(' · ')}
              onSelect={(s) => {
                setSelectedSupplierId(s.rawId);
                setSupplierName(s.name);
                setSupplierPhone(s.phone || '');
              }}
              inputClassName="purchase-prototype-field-input purchase-prototype-supplier-input"
              emptyLabel={t('purchases.create_purchase_order_page.s13', "مورد غير مسجل (يمكنك المتابعة بالاسم المدخل)")}
            />

            {/* Supplier Phone */}
            <Field label={t('purchases.create_purchase_order_page.s14', "رقم الهاتف")}>
              <input
                className="purchase-prototype-field-input"
                type="text"
                placeholder={t('purchases.create_purchase_order_page.s15', "ابحث عن رقم تليفون أو أدخله...")}
                value={supplierPhone}
                onChange={(e) => setSupplierPhone(e.target.value)}
              />
            </Field>

            {/* Payment Type */}
            <Field label={t('purchases.create_purchase_order_page.s16', "طريقة الدفع")}>
              <CustomSelect
                value={paymentType}
                onChange={(val) => setPaymentType(val as 'cash' | 'credit')}
                options={[
                  { value: 'credit', label: t('purchases.create_purchase_order_page.s17', "آجل (حساب المديونية للمورد)") },
                  { value: 'cash', label: t('purchases.create_purchase_order_page.s18', "نقدي (سداد فوري)") },
                ]}
                placeholder={t('purchases.create_purchase_order_page.s19', "اختر طريقة الدفع...")}
              />
            </Field>

            {/* Order Date */}
            <Field label={t('purchases.create_purchase_order_page.s20', "التاريخ")}>
              <input
                className="purchase-prototype-field-input"
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
              />
            </Field>

            {/* Expected Delivery Date */}
            <Field label={t('purchases.create_purchase_order_page.s21', "التاريخ المطلوب")}>
              <input
                className="purchase-prototype-field-input"
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              />
            </Field>

            {/* Currency */}
            <Field label={t('purchases.create_purchase_order_page.s22', "العملة")}>
              <CustomSelect
                value={currency}
                onChange={(val) => setCurrency(val)}
                options={[
                  { value: 'EGP', label: t('purchases.create_purchase_order_page.s23', "EGP - جنيه مصري") },
                  { value: 'USD', label: t('purchases.create_purchase_order_page.s24', "USD - دولار أمريكي") },
                  { value: 'SAR', label: t('purchases.create_purchase_order_page.s25', "SAR - ريال سعودي") },
                  { value: 'AED', label: t('purchases.create_purchase_order_page.s26', "AED - درهم إماراتي") },
                ]}
                placeholder={t('purchases.create_purchase_order_page.s27', "اختر العملة...")}
              />
            </Field>
          </div>
        </section>

        {/* Section 2: Items Table */}
        <section className="document-prototype-section" style={{ marginTop: '12px' }}>
          <div className="section-header-compact-row" style={{ marginBottom: '0.6rem' }}>
            <h3 className="document-prototype-section-title">{t('purchases.create_purchase_order_page.s28', "الأصناف")}</h3>
            <div className="purchase-prototype-quick-actions" aria-label={t('purchases.create_purchase_order_page.s29', "إجراءات سريعة")}>
              <button
                type="button"
                className="purchase-prototype-quick-action"
                title={t('purchases.create_purchase_order_page.s30', "إضافة صنف جديد")}
                onClick={handleAddItem}
                style={{ fontWeight: 700, color: '#1e40af' }}
              >
                <span aria-hidden="true">+</span>
                <span>{t('purchases.create_purchase_order_page.s31', "صنف")}</span>
              </button>
              <button
                type="button"
                className="purchase-prototype-quick-action"
                title={t('purchases.create_purchase_order_page.s32', "إضافة بند خدمة لا يؤثر على المخزون")}
                onClick={handleAddServiceLine}
                style={{ fontWeight: 700, color: '#0284c7' }}
              >
                <span aria-hidden="true">+</span>
                <span>{t('purchases.create_purchase_order_page.s33', "خدمة")}</span>
              </button>
              <button
                type="button"
                className="purchase-prototype-quick-action"
                title={t('purchases.create_purchase_order_page.s34', "تطبيق ضريبة")}
                onClick={() => setActiveQuickAction((curr) => (curr === 'tax' ? null : 'tax'))}
                style={
                  taxRate > 0
                    ? { borderColor: '#2563eb', color: '#1d4ed8', backgroundColor: '#eff6ff', fontWeight: 700 }
                    : undefined
                }
              >
                <span aria-hidden="true">%</span>
                <span>{t('purchases.create_purchase_order_page.s35', "ضريبة")}{taxRate > 0 ? ` ${taxRate}%` : ''}</span>
              </button>
              <button
                type="button"
                className="purchase-prototype-quick-action"
                title={t('purchases.create_purchase_order_page.s36', "إضافة خصم")}
                onClick={() => setActiveQuickAction((curr) => (curr === 'discount' ? null : 'discount'))}
                style={
                  discountValue > 0
                    ? { borderColor: '#16a34a', color: '#15803d', backgroundColor: '#f0fdf4', fontWeight: 700 }
                    : undefined
                }
              >
                <span>{t('purchases.create_purchase_order_page.s37', "خصم")}{discountValue > 0 ? (discountMode === 'percent' ? ` ${discountValue}%` : ` ${discountValue}`) : ''}</span>
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
                  {t('purchases.create_purchase_order_page.s38', "بدون ضريبة")}
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
                  {t('purchases.create_purchase_order_page.s39', "14% (قيمة مضافة قياسية)")}
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
                  {t('purchases.create_purchase_order_page.s40', "15% (الضريبة الخليجية)")}
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
                  <option value="value">{t('purchases.create_purchase_order_page.s41', "مبلغ ثابت (ج.م)")}</option>
                  <option value="percent">{t('purchases.create_purchase_order_page.s42', "نسبة مئوية (%)")}</option>
                </select>
                <input
                  type="number"
                  min="0"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(Number(e.target.value) || 0)}
                  placeholder={t('purchases.create_purchase_order_page.s43', "قيمة الخصم...")}
                  style={{ width: '120px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', textAlign: 'center' }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setActiveQuickAction(null)}
                  style={{ height: '32px', fontSize: '12px' }}
                >
                  {t('purchases.create_purchase_order_page.s44', "تطبيق")}
                </Button>
              </div>
            </div>
          )}

          {/* Desktop Items Table */}
          <div className="document-line-items-table-wrap">
            <table className="document-line-items-table">
              <thead>
                <tr>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-product" style={{ width: '35%', textAlign: 'right' }}>{t('purchases.create_purchase_order_page.s45', "الصنف")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-category" style={{ width: '15%', textAlign: 'center' }}>{t('purchases.create_purchase_order_page.s46', "الوحدة")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-warehouse" style={{ width: '15%', textAlign: 'center' }}>{t('purchases.create_purchase_order_page.s47', "المخزن")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-qty" style={{ width: '10%', textAlign: 'center' }}>{t('purchases.create_purchase_order_page.s48', "الكمية")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-price" style={{ width: '10%', textAlign: 'center' }}>{t('purchases.create_purchase_order_page.s49', "السعر")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-amount" style={{ width: '10%', textAlign: 'center' }}>{t('purchases.create_purchase_order_page.s50', "المبلغ")}</th>
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
                        placeholder={t('purchases.create_purchase_order_page.s51', "ابحث عن صنف أو اكتب صنفاً جديداً...")}
                        value={line.productName}
                        onChange={(value) => handleUpdateLine(line.id, 'productName', value)}
                        options={productOptions}
                        getLabel={(p) => p.name}
                        getMeta={(p) => [p.barcode, p.costPrice > 0 ? `${formatCurrency(p.costPrice)}` : undefined].filter(Boolean).join(' · ')}
                        search={(p, query) =>
                          matchesArabic(p.name, query) ||
                          (p.barcode ? p.barcode.includes(query) : false) ||
                          (p.sku ? p.sku.toLowerCase().includes(query.toLowerCase()) : false)
                        }
                        onSelect={(option) => handleProductSelect(line.id, option)}
                        showDropdownOnEmpty={true}
                        emptyLabel={t('purchases.create_purchase_order_page.s52', "صنف جديد غير مسجل بالدليل (يمكنك المتابعة بالاسم المدخل)")}
                      />
                    </td>

                    {/* Unit */}
                    <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                      <input
                        className="purchase-prototype-table-input"
                        type="text"
                        placeholder={t('purchases.create_purchase_order_page.s53', "الوحدة (قطعة، متر...)")}
                        value={line.unitName || ''}
                        onChange={(e) => handleUpdateLine(line.id, 'unitName', e.target.value)}
                        style={{ textAlign: 'center' }}
                      />
                    </td>

                    {/* Warehouse */}
                    <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                      <input
                        className="purchase-prototype-table-input"
                        type="text"
                        placeholder={t('purchases.create_purchase_order_page.s54', "المستودع...")}
                        value={line.warehouse || warehouseName}
                        onChange={(e) => handleUpdateLine(line.id, 'warehouse', e.target.value)}
                        style={{ textAlign: 'center' }}
                      />
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
                        value={line.unitCost}
                        onChange={(e) => handleUpdateLine(line.id, 'unitCost', Math.max(0, Number(e.target.value) || 0))}
                        style={{ textAlign: 'center', fontWeight: 600 }}
                      />
                    </td>

                    {/* Line Total */}
                    <td className="line-total" style={{ textAlign: 'center', fontWeight: 700, color: '#170e5e' }}>
                      {formatCurrency(line.total || 0)}
                    </td>

                    {/* Delete Row Button */}
                    <td className="purchase-prototype-table-cell purchase-prototype-table-cell-actions" style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="document-row-delete purchase-prototype-row-delete"
                        onClick={() => handleRemoveLine(line.id)}
                        disabled={items.length === 1}
                        title={t('purchases.create_purchase_order_page.s55', "حذف البند")}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Line Actions (Dashed Buttons matching Image 2) */}
          <div className="document-line-items-actions" style={{ marginTop: '12px' }}>
            <Button type="button" variant="dashedAction" onClick={handleAddItem}>
              <span aria-hidden="true">+</span>
              <span>{t('purchases.create_purchase_order_page.s56', "إضافة صنف")}</span>
            </Button>
            <Button type="button" variant="dashedAction" onClick={handleBarcodeScan}>
              <span aria-hidden="true" className="purchase-prototype-scan-icon">
                <svg viewBox="0 0 16 16" role="img" focusable="false" aria-hidden="true" width="14" height="14">
                  <path d="M3 4.2V3.1A.6.6 0 0 1 3.6 2.5h1.1M11.3 2.5h1.1a.6.6 0 0 1 .6.6v1.1M13 11.8v1.1a.6.6 0 0 1-.6.6h-1.1M4.7 13.5H3.6a.6.6 0 0 1-.6-.6v-1.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M5.1 5.2v5.6M7 5.2v5.6M9 5.2v5.6M10.9 5.2v5.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </span>
              <span>{t('purchases.create_purchase_order_page.s57', "مسح باركود")}</span>
            </Button>
            <Button
              type="button"
              variant="dashedAction"
              onClick={() => {
                const name = window.prompt(t('purchases.create_purchase_order_page.s58', "أدخل اسم الصنف الجديد:"));
                if (name && name.trim()) {
                  setItems((prev) => [
                    ...prev,
                    {
                      id: Date.now() + Math.random(),
                      productId: undefined,
                      productName: name.trim(),
                      unitName: t('purchases.create_purchase_order_page.s59', "قطعة"),
                      quantity: 1,
                      unitCost: 0,
                      total: 0,
                      discount: 0,
                      warehouse: warehouseName,
                    },
                  ]);
                }
              }}
            >
              <span aria-hidden="true">+</span>
              <span>{t('purchases.create_purchase_order_page.s60', "منتج جديد")}</span>
            </Button>
          </div>
        </section>

        {/* Section 3: Advanced Operations */}
        <section className="document-prototype-section" style={{ marginTop: '12px' }}>
          <h3 className="document-prototype-section-title">{t('purchases.create_purchase_order_page.s61', "موديول الشركات والعمليات المتقدمة")}</h3>
          <div className="document-prototype-grid compact-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            <Field label={t('purchases.create_purchase_order_page.s62', "مستودع الاستلام (المخزن أو الفرع)")}>
              <input
                className="purchase-prototype-field-input"
                type="text"
                placeholder={t('purchases.create_purchase_order_page.s63', "اسم المستودع أو الفرع...")}
                value={warehouseName}
                onChange={(e) => setWarehouseName(e.target.value)}
              />
            </Field>

            <Field label={t('purchases.create_purchase_order_page.s64', "مركز التكلفة")}>
              <input
                className="purchase-prototype-field-input"
                type="text"
                placeholder={t('purchases.create_purchase_order_page.s65', "ابحث عن مركز تكلفة...")}
                disabled
                value={t('purchases.create_purchase_order_page.s66', "المركز الرئيسي - عام")}
                style={{ backgroundColor: '#f8fafc', color: '#64748b' }}
              />
            </Field>

            <Field label={t('purchases.create_purchase_order_page.s67', "المشروع")}>
              <input
                className="purchase-prototype-field-input"
                type="text"
                placeholder={t('purchases.create_purchase_order_page.s68', "ابحث عن مشروع...")}
                disabled
                value={t('purchases.create_purchase_order_page.s69', "عام / بدون مشروع محدد")}
                style={{ backgroundColor: '#f8fafc', color: '#64748b' }}
              />
            </Field>
          </div>
        </section>

        {/* Section 4: Terms & Conditions */}
        <section className="document-prototype-section" style={{ marginTop: '12px' }}>
          <h3 className="document-prototype-section-title">{t('purchases.create_purchase_order_page.s70', "الشروط والأحكام")}</h3>
          <textarea
            className="purchase-prototype-notes-textarea"
            rows={3}
            value={termsConditions}
            onChange={(e) => setTermsConditions(e.target.value)}
            placeholder={t('purchases.create_purchase_order_page.s71', "الشروط والأحكام الخاصة بالتوريد وفحص البضاعة...")}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
        </section>

        {/* Section 5: Notes & Totals (Matching Image 2 Bottom Layout) */}
        <section className="document-prototype-bottom-grid" style={{ marginTop: '12px' }}>
          {/* Notes Card */}
          <div className="document-prototype-section">
            <h3 className="document-prototype-section-title">{t('purchases.create_purchase_order_page.s72', "ملاحظات")}</h3>
            <textarea
              className="purchase-prototype-notes-textarea"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('purchases.create_purchase_order_page.s73', "ملاحظات إضافية للتوريد...")}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          {/* Totals Card */}
          <div className="document-prototype-section document-totals-card">
            <h3 className="document-prototype-section-title">{t('purchases.create_purchase_order_page.s74', "الإجماليات")}</h3>
            <div className="document-totals-panel">
              <div>
                <span>{t('purchases.create_purchase_order_page.s75', "الإجمالي الفرعي:")}</span>
                <strong>{formatCurrencyWithSymbol(subtotal, currency)}</strong>
              </div>
              {discountTotal > 0 && (
                <div style={{ color: '#16a34a' }}>
                  <span>{t('purchases.create_purchase_order_page.s76', "الخصم:")}</span>
                  <strong>- {formatCurrencyWithSymbol(discountTotal, currency)}</strong>
                </div>
              )}
              <div>
                <span>{t('purchases.create_purchase_order_page.s77', "الضريبة (")}{taxRate}%):</span>
                <strong>{formatCurrencyWithSymbol(taxAmount, currency)}</strong>
              </div>
              <div className="document-total-grand" style={{ borderTop: '2px solid #e2e8f0', paddingTop: '8px', marginTop: '6px' }}>
                <span>{t('purchases.create_purchase_order_page.s78', "الإجمالي:")}</span>
                <strong>{formatCurrencyWithSymbol(totalAmount, currency)}</strong>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
