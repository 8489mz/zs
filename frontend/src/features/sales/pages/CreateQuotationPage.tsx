import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateQuotationForm, type CreateQuotationPayload, type QuotationItem } from '../hooks/useCreateQuotationForm';
import { useProductsQuery } from '@/shared/hooks/use-catalog-queries';
import { useAppToolbar } from '@/stores/toolbar-store';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { SearchableCombobox } from '@/shared/ui/searchable-combobox';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { useFormDraft } from '@/shared/hooks/use-form-draft';
import { DraftRestoredBanner } from '@/shared/components/DraftRestoredBanner';
import { matchesArabic } from '@/lib/arabic-normalization';
import { formatCurrency, formatCurrencyWithSymbol } from '@/lib/format';
import {
  PlusIcon,
  Trash2Icon,
  ClockIcon,
  SlidersIcon,
  UsersIcon,
  UploadIcon,
} from '@/shared/components/icons/AppIcons';
import type { Product } from '@/types/domain';

interface QuotationFormItem extends QuotationItem {
  id: number;
  stockOnHand?: number;
  barcode?: string;
  notes?: string;
}

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
  const [quotationDate, setQuotationDate] = useState(new Date().toISOString().split('T')[0]);
  const [validUntil, setValidUntil] = useState(
    new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
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
      if (restored.items && Array.isArray(restored.items)) setItems(restored.items);
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
    handleUpdateItem(itemId, {
      productId: option.rawId,
      productName: option.name,
      product_name: option.name,
      unitPrice: option.price,
      unit_price: option.price,
      unitName: option.unit || 'قطعة',
      stockOnHand: option.stock,
      barcode: option.barcode || '',
    });
  };

  const handleSubmit = () => {
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
        {/* Universal Page Header */}
        <PageHeader
          title={t('sales.create_quotation_page.s0', "إنشاء عرض سعر جديد (Quotation)")}
          description={t('sales.create_quotation_page.s1', "تجهيز وتسعير عروض الأسعار الرسمية للعملاء، حساب الضرائب والخصومات، وتوثيق الشروط التعاقدية وفترة الصلاحية.")}
          badge={
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="badge is-draft" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <ClockIcon size={12} />
                {t('sales.create_quotation_page.s2', "مسودة عرض سعر")}
              </span>
              <span className="badge" style={{ backgroundColor: '#f1f5f9', color: '#1e293b', fontWeight: 700 }}>
                {formatCurrencyWithSymbol(calculations.grandTotal, currency)}
              </span>
            </div>
          }
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px' }}>
              <Button
                variant="secondary"
                onClick={async () => {
                  const ok = await systemConfirm({
                    title: t('sales.create_quotation_page.s3', "إلغاء المسودة"),
                    message: t('sales.create_quotation_page.s4', "هل أنت متأكد من إلغاء المسودة والعودة؟"),
                    confirmText: t('sales.create_quotation_page.s5', "إلغاء المسودة"),
                    variant: 'danger',
                  });
                  if (ok) {
                    clearDraft();
                    navigate('/quotations');
                  }
                }}
                style={{ color: '#dc2626', borderColor: '#fecaca' }}
              >
                {t('sales.create_quotation_page.s6', "إلغاء المسودة")}
              </Button>
              <Button
                variant="secondary"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {t('sales.create_quotation_page.s7', "حفظ كمسودة")}
              </Button>
              <Button
                variant="primary"
                onClick={handleSubmit}
                disabled={isSubmitting}
                style={{ backgroundColor: '#170e5e', color: '#ffffff', minWidth: '130px' }}
              >
                {isSubmitting ? t('sales.create_quotation_page.s8', "جاري الحفظ...") : t('sales.create_quotation_page.s9', "اعتماد عرض السعر")}
              </Button>
            </div>
          }
        />

        {/* Section 1: Customer & Quotation Info */}
        <section className="document-prototype-section" style={{ marginTop: '12px' }}>
          <div className="document-prototype-section-title">
            <UsersIcon size={16} color="#170e5e" />
            <span>{t('sales.create_quotation_page.s10', "بيانات العميل وفترة الصلاحية")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px' }}>
            <Field label={t('sales.create_quotation_page.s11', "اسم العميل *")}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <CustomSelect
                    value={selectedCustomerId ? String(selectedCustomerId) : ''}
                    onChange={(val) => handleCustomerSelect(val)}
                    options={[
                      { value: '', label: t('sales.create_quotation_page.s12', "عميل نقدي / اختيار من القائمة...") },
                      ...customers.map((c: any) => ({
                        value: String(c.id),
                        label: `${c.name} ${c.phone ? `(${c.phone})` : ''}`,
                        hint: c.taxNumber || c.code,
                      })),
                    ]}
                    placeholder={t('sales.create_quotation_page.s13', "اختر عميل مسجل...")}
                  />
                </div>
                <input
                  type="text"
                  placeholder={t('sales.create_quotation_page.s14', "أو اكتب اسم العميل مباشرة")}
                  value={customerName}
                  onChange={(e) => {
                    setCustomerName(e.target.value);
                    if (selectedCustomerId) setSelectedCustomerId(null);
                  }}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                  }}
                />
              </div>
            </Field>

            <Field label={t('sales.create_quotation_page.s15', "رقم هاتف العميل")}>
              <input
                type="tel"
                placeholder="010XXXXXXXX"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                }}
              />
            </Field>

            <Field label={t('sales.create_quotation_page.s16', "عنوان العميل")}>
              <input
                type="text"
                placeholder={t('sales.create_quotation_page.s17', "المدينة، الحي، اسم الشارع...")}
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                }}
              />
            </Field>

            <Field label={t('sales.create_quotation_page.s18', "تاريخ عرض السعر")}>
              <input
                type="date"
                value={quotationDate}
                onChange={(e) => setQuotationDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                }}
              />
            </Field>

            <Field label={t('sales.create_quotation_page.s19', "ساري حتى تاريخ (Validity Period)")}>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                }}
              />
            </Field>

            <Field label={t('sales.create_quotation_page.s20', "العملة")}>
              <CustomSelect
                value={currency}
                onChange={(val) => setCurrency(val)}
                options={[
                  { value: 'EGP', label: t('sales.create_quotation_page.s21', "جنيه مصري (EGP)") },
                  { value: 'SAR', label: t('sales.create_quotation_page.s22', "ريال سعودي (SAR)") },
                  { value: 'AED', label: t('sales.create_quotation_page.s23', "درهم إماراتي (AED)") },
                  { value: 'USD', label: t('sales.create_quotation_page.s24', "دولار أمريكي (USD)") },
                  { value: 'EUR', label: t('sales.create_quotation_page.s25', "يورو أوروبي (EUR)") },
                ]}
              />
            </Field>
          </div>
        </section>

        {/* Section 2: Quick Action Toolbar */}
        <section className="document-prototype-section" style={{ marginTop: '12px' }}>
          <div className="section-header-compact-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="document-prototype-section-title" style={{ margin: 0 }}>
              <SlidersIcon size={16} color="#170e5e" />
              <span>{t('sales.create_quotation_page.s26', "بنود عرض السعر (Line Items)")}</span>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleAddItem('product')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <PlusIcon size={14} />
                {t('sales.create_quotation_page.s27', "+ صنف")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleAddItem('service')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <PlusIcon size={14} />
                {t('sales.create_quotation_page.s28', "+ خدمة")}
              </Button>
              <Button
                variant={activeQuickAction === 'tax' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setActiveQuickAction(activeQuickAction === 'tax' ? null : 'tax')}
              >
                {t('sales.create_quotation_page.s29', "% ضريبة")}
              </Button>
              <Button
                variant={activeQuickAction === 'discount' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setActiveQuickAction(activeQuickAction === 'discount' ? null : 'discount')}
              >
                {t('sales.create_quotation_page.s30', "خصم إجمالي")}
              </Button>
            </div>
          </div>

          {/* Quick Action Flyouts */}
          {activeQuickAction === 'tax' && (
            <div
              style={{
                marginTop: '12px',
                padding: '12px 16px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                {t('sales.create_quotation_page.s31', "تطبيق ضريبة قيمة مضافة إجمالية:")}
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[0, 5, 14, 15].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setTaxRate(rate)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      border: taxRate === rate ? '1px solid #170e5e' : '1px solid #cbd5e1',
                      background: taxRate === rate ? '#170e5e' : '#ffffff',
                      color: taxRate === rate ? '#ffffff' : '#475569',
                      cursor: 'pointer',
                    }}
                  >
                    {rate}%
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="0"
                max="100"
                value={taxRate}
                onChange={(e) => setTaxRate(Number(e.target.value) || 0)}
                onFocus={(e) => e.target.select()}
                style={{ width: '80px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
              <span style={{ fontSize: '12px', color: '#64748b' }}>%</span>
            </div>
          )}

          {activeQuickAction === 'discount' && (
            <div
              style={{
                marginTop: '12px',
                padding: '12px 16px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>{t('sales.create_quotation_page.s32', "تطبيق خصم إجمالي:")}</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setDiscountMode('value')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    border: discountMode === 'value' ? '1px solid #170e5e' : '1px solid #cbd5e1',
                    background: discountMode === 'value' ? '#170e5e' : '#ffffff',
                    color: discountMode === 'value' ? '#ffffff' : '#475569',
                    cursor: 'pointer',
                  }}
                >
                  {t('sales.create_quotation_page.s33', "مبلغ ثابت")}
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountMode('percent')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    border: discountMode === 'percent' ? '1px solid #170e5e' : '1px solid #cbd5e1',
                    background: discountMode === 'percent' ? '#170e5e' : '#ffffff',
                    color: discountMode === 'percent' ? '#ffffff' : '#475569',
                    cursor: 'pointer',
                  }}
                >
                  {t('sales.create_quotation_page.s34', "نسبة مئوية %")}
                </button>
              </div>
              <input
                type="number"
                min="0"
                value={discountValue}
                onChange={(e) => setDiscountValue(Number(e.target.value) || 0)}
                onFocus={(e) => e.target.select()}
                style={{ width: '100px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                {discountMode === 'percent' ? '%' : currency}
              </span>
            </div>
          )}

          {/* Line Items Table */}
          <div className="document-line-items-table-wrap" style={{ marginTop: '14px' }}>
            <table className="document-line-items-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                  <th style={{ textAlign: 'right', minWidth: '220px' }}>{t('sales.create_quotation_page.s35', "الصنف / الوصف")}</th>
                  <th style={{ width: '110px', textAlign: 'center' }}>{t('sales.create_quotation_page.s36', "الوحدة")}</th>
                  <th style={{ width: '100px', textAlign: 'center' }}>{t('sales.create_quotation_page.s37', "الكمية")}</th>
                  <th style={{ width: '120px', textAlign: 'center' }}>{t('sales.create_quotation_page.s38', "سعر الوحدة")}</th>
                  <th style={{ width: '100px', textAlign: 'center' }}>{t('sales.create_quotation_page.s39', "الخصم")}</th>
                  <th style={{ width: '90px', textAlign: 'center' }}>{t('sales.create_quotation_page.s40', "الضريبة %")}</th>
                  <th style={{ width: '130px', textAlign: 'center' }}>{t('sales.create_quotation_page.s41', "الإجمالي")}</th>
                  <th style={{ width: '50px', textAlign: 'center' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.id}>
                    <td style={{ textAlign: 'center', color: '#64748b', fontSize: '12px' }}>{idx + 1}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <SearchableCombobox
                          inline
                          className="purchase-prototype-inline-combobox"
                          inputClassName="purchase-prototype-field-input purchase-prototype-combobox-input purchase-prototype-combobox-input-inline"
                          placeholder={t('sales.create_quotation_page.s42', "ابحث عن صنف بالاسم أو الباركود...")}
                          value={item.productName || item.product_name || ''}
                          onChange={(value) => handleUpdateItem(item.id, { productName: value, product_name: value })}
                          options={productOptions}
                          getLabel={(p) => p.name}
                          getMeta={(p) => [p.barcode, p.price > 0 ? `${formatCurrency(p.price)}` : undefined, `رصيد: ${p.stock}`].filter(Boolean).join(' · ')}
                          search={(p, query) =>
                            matchesArabic(p.name, query) ||
                            (p.barcode ? p.barcode.includes(query) : false) ||
                            (p.sku ? p.sku.toLowerCase().includes(query.toLowerCase()) : false)
                          }
                          onSelect={(option) => handleProductSelect(item.id, option)}
                          showDropdownOnEmpty={true}
                          emptyLabel={t('sales.create_quotation_page.s43', "صنف جديد (يمكنك المتابعة بالاسم المدخل)")}
                        />
                        <input
                          type="text"
                          placeholder={t('sales.create_quotation_page.s44', "أو اكتب وصف البند / الصنف يدوياً...")}
                          value={item.productName || item.product_name || ''}
                          onChange={(e) => handleUpdateItem(item.id, { productName: e.target.value })}
                          style={{
                            padding: '4px 8px',
                            fontSize: '12px',
                            border: '1px solid #e2e8f0',
                            borderRadius: '4px',
                            background: '#f8fafc',
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      <CustomSelect
                        value={item.unitName || t('sales.create_quotation_page.s45', "قطعة")}
                        onChange={(val) => handleUpdateItem(item.id, { unitName: val })}
                        options={[
                          { value: t('sales.create_quotation_page.s46', "قطعة"), label: t('sales.create_quotation_page.s47', "قطعة") },
                          { value: t('sales.create_quotation_page.s48', "كرتونة"), label: t('sales.create_quotation_page.s49', "كرتونة") },
                          { value: t('sales.create_quotation_page.s50', "كيلو"), label: t('sales.create_quotation_page.s51', "كيلو") },
                          { value: t('sales.create_quotation_page.s52', "متر"), label: t('sales.create_quotation_page.s53', "متر") },
                          { value: t('sales.create_quotation_page.s54', "خدمة"), label: t('sales.create_quotation_page.s55', "خدمة") },
                          { value: t('sales.create_quotation_page.s56', "طقم"), label: t('sales.create_quotation_page.s57', "طقم") },
                        ]}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => handleUpdateItem(item.id, { quantity: Number(e.target.value) || 1 })}
                        onFocus={(e) => e.target.select()}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          textAlign: 'center',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          fontWeight: 600,
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitPrice ?? item.unit_price ?? 0}
                        onChange={(e) => handleUpdateItem(item.id, { unitPrice: Number(e.target.value) || 0 })}
                        onFocus={(e) => e.target.select()}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          textAlign: 'center',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          fontWeight: 600,
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.discount || 0}
                        onChange={(e) => handleUpdateItem(item.id, { discount: Number(e.target.value) || 0 })}
                        onFocus={(e) => e.target.select()}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          textAlign: 'center',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={item.tax_rate || 0}
                        onChange={(e) => handleUpdateItem(item.id, { tax_rate: Number(e.target.value) || 0 })}
                        onFocus={(e) => e.target.select()}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          textAlign: 'center',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                        }}
                      />
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: '#170e5e', fontSize: '13px' }}>
                      {formatCurrency(item.total || 0)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        disabled={items.length <= 1}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          cursor: items.length <= 1 ? 'not-allowed' : 'pointer',
                          color: items.length <= 1 ? '#cbd5e1' : '#ef4444',
                          padding: '4px',
                        }}
                        title={t('sales.create_quotation_page.s58', "حذف البند")}
                      >
                        <Trash2Icon size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Bottom Dashed Actions */}
            <div
              style={{
                display: 'flex',
                gap: '12px',
                padding: '12px',
                background: '#f8fafc',
                borderTop: '1px dashed #cbd5e1',
              }}
            >
              <button
                type="button"
                onClick={() => handleAddItem('product')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: '1px dashed #94a3b8',
                  background: '#ffffff',
                  color: '#170e5e',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <PlusIcon size={14} />
                {t('sales.create_quotation_page.s59', "+ إضافة بند صنف جديد")}
              </button>
              <button
                type="button"
                onClick={() => handleAddItem('service')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: '1px dashed #94a3b8',
                  background: '#ffffff',
                  color: '#475569',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <PlusIcon size={14} />
                {t('sales.create_quotation_page.s60', "+ إضافة بند خدمة")}
              </button>
            </div>
          </div>
        </section>

        {/* Section 4: 60/40 Symmetrical Bottom Split */}
        <section className="document-prototype-section" style={{ marginTop: '12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: '24px' }}>
            {/* Right Side (60%): Notes, Terms & Attachments */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  {t('sales.create_quotation_page.s61', "ملاحظات إضافية على عرض السعر")}
                </label>
                <textarea
                  rows={3}
                  placeholder={t('sales.create_quotation_page.s62', "أدخل أي ملاحظات خاصة بالعميل أو بالمواصفات الفنية...")}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    lineHeight: 1.5,
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  {t('sales.create_quotation_page.s63', "الشروط والأحكام والضمانات التعاقدية")}
                </label>
                <textarea
                  rows={4}
                  value={termsConditions}
                  onChange={(e) => setTermsConditions(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    lineHeight: 1.6,
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* Attachments */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  {t('sales.create_quotation_page.s64', "المرفقات والمستندات")}
                </label>
                <div
                  style={{
                    border: '2px dashed #cbd5e1',
                    borderRadius: '8px',
                    padding: '16px',
                    textAlign: 'center',
                    background: '#f8fafc',
                    cursor: 'pointer',
                  }}
                  onClick={() => document.getElementById('quotation-file-input')?.click()}
                >
                  <UploadIcon size={20} color="#64748b" style={{ margin: '0 auto 6px' }} />
                  <div style={{ fontSize: '12.5px', color: '#475569', fontWeight: 600 }}>
                    {t('sales.create_quotation_page.s65', "انقر لإرفاق عروض مواصفات أو كتالوجات أو مستندات")}
                  </div>
                  <input
                    id="quotation-file-input"
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFileUpload}
                  />
                </div>
                {attachments.length > 0 && (
                  <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {attachments.map((f, i) => (
                      <span
                        key={i}
                        style={{
                          background: '#e2e8f0',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '11.5px',
                          color: '#334155',
                        }}
                      >
                        {f.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Left Side (40%): Financial Summary Card */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '15px',
                    fontWeight: 800,
                    color: '#170e5e',
                    borderBottom: '1px solid #e2e8f0',
                    paddingBottom: '12px',
                    marginBottom: '16px',
                  }}
                >
                  {t('sales.create_quotation_page.s66', "ملخص القيمة الإجمالية")}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569' }}>
                    <span>{t('sales.create_quotation_page.s67', "المجموع قبل الخصم:")}</span>
                    <span style={{ fontWeight: 600 }}>{formatCurrencyWithSymbol(calculations.rawSubtotal, currency)}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#16a34a' }}>
                    <span>{t('sales.create_quotation_page.s68', "إجمالي الخصومات:")}</span>
                    <span style={{ fontWeight: 600 }}>- {formatCurrencyWithSymbol(calculations.totalDiscount, currency)}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569' }}>
                    <span>{t('sales.create_quotation_page.s69', "الصافي الخاضع للضريبة:")}</span>
                    <span style={{ fontWeight: 600 }}>{formatCurrencyWithSymbol(calculations.netTaxable, currency)}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569' }}>
                    <span>{t('sales.create_quotation_page.s70', "ضريبة القيمة المضافة:")}</span>
                    <span style={{ fontWeight: 600 }}>+ {formatCurrencyWithSymbol(calculations.taxTotal, currency)}</span>
                  </div>

                  <div
                    style={{
                      marginTop: '8px',
                      paddingTop: '12px',
                      borderTop: '2px solid #cbd5e1',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                    }}
                  >
                    <span style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>{t('sales.create_quotation_page.s71', "الإجمالي النهائي:")}</span>
                    <span style={{ fontSize: '20px', fontWeight: 900, color: '#170e5e' }}>
                      {formatCurrencyWithSymbol(calculations.grandTotal, currency)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons at bottom of card */}
              <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Button
                  variant="primary"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  style={{
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    width: '100%',
                    padding: '12px',
                    fontSize: '14px',
                    fontWeight: 700,
                  }}
                >
                  {isSubmitting ? t('sales.create_quotation_page.s72', "جاري الحفظ...") : t('sales.create_quotation_page.s73', "اعتماد وحفظ عرض السعر")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    clearDraft();
                    navigate('/quotations');
                  }}
                  style={{ width: '100%', fontSize: '13px' }}
                >
                  {t('sales.create_quotation_page.s74', "العودة لقائمة عروض الأسعار")}
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default CreateQuotationPage;
