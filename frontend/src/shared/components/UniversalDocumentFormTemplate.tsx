import { useTranslation } from 'react-i18next';
/**
 * ==============================================================================
 * Universal Document Form Template (النموذج المرجعي القياسي لوثائق وفورمز المعاملات الكبرى)
 * ==============================================================================
 * 
 * المرجع الدستوري الإلزامي لكافة صفحات إنشاء وتعديل الوثائق التجارية والمالية في Z-Systems:
 * (أوامر الشراء، فواتير المشتريات، أوامر البيع وحجز المخزون، عروض الأسعار، أذون الصرف).
 * 
 * القواعد الجوهرية لهذا النموذج:
 * 1. صفحة كاملة مستقلة (Full Page) دائماً، وممنوع حشر الوثائق في بوب اب (Modal).
 * 2. حاوية 1280px قياسية ثابتة: `max-width: 1280px; width: min(100%, 1280px); margin: 0 auto;`.
 * 3. ترويسة موحدة (PageHeader) مع شارات الحالة والإجمالي المالي اللحظي + أزرار القرار أعلى اليسار.
 * 4. تمييز الأقسام بالخط الكحلي الرأسي الإلزامي (`|`) عبر الكلاس `.document-prototype-section-title`.
 * 5. شريط أدوات سريع لجدول الأصناف (`+ صنف`, `+ خدمة`, `% ضريبة`, `خصم`) + أزرار متقطعة سفلية (`dashedAction`).
 * 6. توازن الجزء السفلي: الملاحظات يميناً (60%) والإجماليات الحسابية يساراً (40%).
 * 7. دعم الحفظ التلقائي للمسودات (`useFormDraft`) وشريط الاستعادة (`DraftRestoredBanner`).
 */

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { SearchableCombobox } from '@/shared/ui/searchable-combobox';
import { toast } from '@/shared/components/system-alert';
import { useFormDraft } from '@/shared/hooks/use-form-draft';
import { DraftRestoredBanner } from '@/shared/components/DraftRestoredBanner';
import { matchesArabic } from '@/lib/arabic-normalization';
import { formatCurrency, formatCurrencyWithSymbol, addDaysLocalDateKey, todayLocalDateKey } from '@/lib/format';

export interface TemplateLineItem {
  id: number;
  productId?: number;
  productName: string;
  unitName: string;
  warehouse?: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export function UniversalDocumentFormTemplate() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // 1. Header State
  const [partnerName, setPartnerName] = useState('');
  const [partnerPhone, setPartnerPhone] = useState('');
  const [paymentType, setPaymentType] = useState<'cash' | 'credit'>('credit');
  const [documentDate, setDocumentDate] = useState(todayLocalDateKey());
  const [dueDate, setDueDate] = useState(addDaysLocalDateKey(7));
  const [currency, setCurrency] = useState('EGP');
  const [warehouseName, setWarehouseName] = useState('المستودع الرئيسي');

  // 2. Quick Action State (Tax & Discount)
  const [taxRate, setTaxRate] = useState<number>(0);
  const [discountMode] = useState<'percent' | 'value'>('value');
  const [discountValue, setDiscountValue] = useState<number>(0);

  // 3. Attachments State
  const [attachments, setAttachments] = useState<File[]>([]);
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      setAttachments((prev) => [...prev, ...newFiles]);
      toast.success(`تم إرفاق ${newFiles.length} ملف بنجاح`);
    }
  };

  // 4. Items State
  const [items, setItems] = useState<TemplateLineItem[]>([
    { id: Date.now(), productName: '', unitName: 'قطعة', warehouse: 'المستودع الرئيسي', quantity: 1, unitPrice: 0, total: 0 },
  ]);

  // 5. Notes & Terms
  const [notes, setNotes] = useState('');
  const [termsConditions, setTermsConditions] = useState('الشروط والأحكام التعاقدية القياسية...');

  // Mock Options (Replace with actual queries in real forms)
  const partnerOptions = [
    { id: '1', rawId: 1, name: 'شركة الأمل للتوريدات', phone: '01012345678', code: 'SUP-001' },
    { id: '2', rawId: 2, name: 'مؤسسة النور للتجارة', phone: '01123456789', code: 'SUP-002' },
  ];

  const productOptions = [
    { id: '1', rawId: 1, name: 'صنف نموذجي أ', barcode: '62210001', costPrice: 150, unit: 'قطعة' },
    { id: '2', rawId: 2, name: 'صنف نموذجي ب', barcode: '62210002', costPrice: 320, unit: 'كرتونة' },
  ];

  // Calculations
  const subtotal = useMemo(() => {
    return items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
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

  // Form Draft Integration
  const draftData = useMemo(() => ({
    partnerName,
    partnerPhone,
    paymentType,
    documentDate,
    dueDate,
    currency,
    warehouseName,
    taxRate,
    discountMode,
    discountValue,
    notes,
    termsConditions,
    items,
  }), [
    partnerName,
    partnerPhone,
    paymentType,
    documentDate,
    dueDate,
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
    setPartnerName('');
    setPartnerPhone('');
    setItems([{ id: Date.now(), productName: '', unitName: 'قطعة', warehouse: 'المستودع الرئيسي', quantity: 1, unitPrice: 0, total: 0 }]);
  };

  const { clearDraft, isDraftRestored, dismissRestoredNotice } = useFormDraft({
    key: 'z_draft_universal_template_doc',
    data: draftData,
    isEmpty: (d) => !d.partnerName?.trim() && !d.items?.some((it: any) => Boolean(it.productName?.trim())),
    onRestore: (saved) => {
      if (saved.partnerName) setPartnerName(saved.partnerName);
      if (saved.items && saved.items.length > 0) setItems(saved.items);
    },
  });

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), productName: '', unitName: 'قطعة', warehouse: warehouseName, quantity: 1, unitPrice: 0, total: 0 },
    ]);
  };

  const handleRemoveItem = (id: number) => {
    if (items.length <= 1) {
      toast.info('يجب أن تحتوي الوثيقة على بند واحد على الأقل');
      return;
    }
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleUpdateLine = (id: number, field: keyof TemplateLineItem, value: any) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const updated = { ...it, [field]: value };
        const qty = Number(updated.quantity) || 0;
        const price = Number(updated.unitPrice) || 0;
        updated.total = Math.max(0, qty * price);
        return updated;
      })
    );
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!partnerName.trim()) {
      toast.warning('يرجى تحديد الطرف المتعامل (العميل أو المورد)');
      return;
    }
    const validItems = items.filter((it) => it.productName.trim() && Number(it.quantity) > 0);
    if (!validItems.length) {
      toast.warning('يرجى إضافة صنف واحد على الأقل وتحديد كميته');
      return;
    }

    toast.success('تم اعتماد الوثيقة بنجاح');
    clearDraft();
    navigate(-1);
  };

  return (
    <div className="purchase-prototype-theme-root" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '32px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        {/* Universal Header */}
        <PageHeader
          title={t('shared.universal_document_form_template.s0', "وثيقة معاملات نموذجية (عنوان الوثيقة)")}
          onBack={() => navigate(-1)}
          badge={
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span className="document-prototype-status-badge is-draft">{t('shared.universal_document_form_template.s1', "مسودة")}</span>
              <span className="nav-pill" style={{ fontWeight: 700, color: '#0f172a' }}>
                {t('shared.universal_document_form_template.s2', "الإجمالي:")} {formatCurrencyWithSymbol(totalAmount, currency)}
              </span>
            </div>
          }
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="secondary"
                type="button"
                className="purchase-prototype-toolbar-action purchase-prototype-toolbar-action-secondary"
                onClick={() => navigate(-1)}
                style={{ color: 'var(--danger-color)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
              >
                <span>{t('shared.universal_document_form_template.s3', "إلغاء المسودة")}</span>
              </Button>
              <Button
                variant="secondary"
                type="button"
                className="purchase-prototype-toolbar-action purchase-prototype-toolbar-action-secondary"
                onClick={() => toast.success(t('shared.universal_document_form_template.s4', "تم حفظ المسودة بنجاح"))}
              >
                <span>{t('shared.universal_document_form_template.s5', "حفظ كمسودة")}</span>
              </Button>
              <Button
                type="button"
                className="purchase-prototype-toolbar-action purchase-prototype-toolbar-action-primary"
                onClick={() => handleSubmit()}
              >
                <span>{t('shared.universal_document_form_template.s6', "اعتماد الوثيقة")}</span>
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
            <h3 className="document-prototype-section-title">{t('shared.universal_document_form_template.s7', "المعلومات الأساسية")}</h3>
            <div className="section-header-actions-group" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <label className="section-header-action-btn purchase-camera-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', margin: 0 }}>
                <input type="file" accept="image/*" capture="environment" onChange={handleFileUpload} style={{ display: 'none' }} />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span>{t('shared.universal_document_form_template.s8', "كاميرا")}</span>
              </label>
              <label className="section-header-action-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', margin: 0 }}>
                <input type="file" multiple onChange={handleFileUpload} style={{ display: 'none' }} />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                  <path d="M21 12.5 12.8 20.7a5 5 0 0 1-7.1-7.1L14.2 5.1a3.5 3.5 0 0 1 4.9 4.9L9.9 19.2" />
                </svg>
                <span>{t('shared.universal_document_form_template.s9', "إرفاق")}</span>
                {attachments.length > 0 && <span className="nav-pill" style={{ fontSize: '0.65rem', padding: '1px 4px', marginInlineStart: '2px' }}>{attachments.length}</span>}
              </label>
            </div>
          </div>

          <div className="purchase-prototype-form-grid">
            <SearchableCombobox
              label={t('shared.universal_document_form_template.s10', "الطرف المتعامل *")}
              placeholder={t('shared.universal_document_form_template.s11', "ابحث بالاسم أو الهاتف...")}
              value={partnerName}
              onChange={setPartnerName}
              options={partnerOptions}
              search={(p, q) => matchesArabic(p.name, q) || p.phone.includes(q)}
              getLabel={(p) => p.name}
              getMeta={(p) => [p.code, p.phone].filter(Boolean).join(' · ')}
              onSelect={(p) => setPartnerName(p.name)}
              inputClassName="purchase-prototype-field-input"
            />
            <Field label={t('shared.universal_document_form_template.s12', "رقم الهاتف")}>
              <input className="purchase-prototype-field-input" type="text" placeholder={t('shared.universal_document_form_template.s13', "رقم التواصل...")} value={partnerPhone} onChange={(e) => setPartnerPhone(e.target.value)} />
            </Field>
            <Field label={t('shared.universal_document_form_template.s14', "طريقة الدفع")}>
              <CustomSelect
                value={paymentType}
                onChange={(val) => setPaymentType(val as 'cash' | 'credit')}
                options={[
                  { value: 'credit', label: t('shared.universal_document_form_template.s15', "آجل (حساب المديونية)") },
                  { value: 'cash', label: t('shared.universal_document_form_template.s16', "نقدي (فوري)") },
                ]}
              />
            </Field>
            <Field label={t('shared.universal_document_form_template.s17', "تاريخ الوثيقة")}>
              <input className="purchase-prototype-field-input" type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
            </Field>
            <Field label={t('shared.universal_document_form_template.s18', "تاريخ الاستحقاق / التوريد")}>
              <input className="purchase-prototype-field-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label={t('shared.universal_document_form_template.s19', "العملة")}>
              <CustomSelect
                value={currency}
                onChange={(val) => setCurrency(val)}
                options={[
                  { value: 'EGP', label: t('shared.universal_document_form_template.s20', "EGP - جنيه مصري") },
                  { value: 'USD', label: t('shared.universal_document_form_template.s21', "USD - دولار أمريكي") },
                  { value: 'SAR', label: t('shared.universal_document_form_template.s22', "SAR - ريال سعودي") },
                ]}
              />
            </Field>
          </div>
        </section>

        {/* Section 2: Items Table */}
        <section className="document-prototype-section" style={{ marginTop: '12px' }}>
          <div className="section-header-compact-row" style={{ marginBottom: '0.6rem' }}>
            <h3 className="document-prototype-section-title">{t('shared.universal_document_form_template.s23', "الأصناف")}</h3>
            <div className="purchase-prototype-quick-actions">
              <button type="button" className="purchase-prototype-quick-action" onClick={handleAddItem} style={{ fontWeight: 700, color: '#1e40af' }}>
                <span aria-hidden="true">+</span>
                <span>{t('shared.universal_document_form_template.s24', "صنف")}</span>
              </button>
              <button
                type="button"
                className="purchase-prototype-quick-action"
                onClick={() => setTaxRate((curr: number) => (curr > 0 ? 0 : 14))}
                style={taxRate > 0 ? { borderColor: '#2563eb', color: '#1d4ed8', backgroundColor: '#eff6ff', fontWeight: 700 } : undefined}
              >
                <span aria-hidden="true">%</span>
                <span>{t('shared.universal_document_form_template.s25', "ضريبة")}{taxRate > 0 ? ` ${taxRate}%` : ''}</span>
              </button>
              <button
                type="button"
                className="purchase-prototype-quick-action"
                onClick={() => setDiscountValue((curr: number) => (curr > 0 ? 0 : 10))}
                style={discountValue > 0 ? { borderColor: '#16a34a', color: '#15803d', backgroundColor: '#f0fdf4', fontWeight: 700 } : undefined}
              >
                <span>{t('shared.universal_document_form_template.s26', "خصم")}{discountValue > 0 ? (discountMode === 'percent' ? ` ${discountValue}%` : ` ${discountValue}`) : ''}</span>
              </button>
            </div>
          </div>

          <div className="document-line-items-table-wrap">
            <table className="document-line-items-table">
              <thead>
                <tr>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-product" style={{ width: '35%', textAlign: 'right' }}>{t('shared.universal_document_form_template.s27', "الصنف")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-category" style={{ width: '15%', textAlign: 'center' }}>{t('shared.universal_document_form_template.s28', "الوحدة")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-warehouse" style={{ width: '15%', textAlign: 'center' }}>{t('shared.universal_document_form_template.s29', "المخزن")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-qty" style={{ width: '10%', textAlign: 'center' }}>{t('shared.universal_document_form_template.s30', "الكمية")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-price" style={{ width: '10%', textAlign: 'center' }}>{t('shared.universal_document_form_template.s31', "السعر")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-amount" style={{ width: '10%', textAlign: 'center' }}>{t('shared.universal_document_form_template.s32', "المبلغ")}</th>
                  <th className="purchase-prototype-table-head purchase-prototype-table-head-actions" style={{ width: '5%', textAlign: 'center' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((line) => (
                  <tr key={line.id}>
                    <td className="purchase-prototype-table-cell purchase-prototype-table-cell-item">
                      <SearchableCombobox
                        inline
                        inputClassName="purchase-prototype-field-input purchase-prototype-combobox-input purchase-prototype-combobox-input-inline"
                        placeholder={t('shared.universal_document_form_template.s33', "ابحث عن صنف أو اكتب صنفاً جديداً...")}
                        value={line.productName}
                        onChange={(value) => handleUpdateLine(line.id, 'productName', value)}
                        options={productOptions}
                        getLabel={(p) => p.name}
                        getMeta={(p) => [p.barcode, `${formatCurrency(p.costPrice)}`].filter(Boolean).join(' · ')}
                        search={(p, q) => matchesArabic(p.name, q) || p.barcode.includes(q)}
                        onSelect={(p) => {
                          handleUpdateLine(line.id, 'productName', p.name);
                          handleUpdateLine(line.id, 'unitPrice', p.costPrice);
                          handleUpdateLine(line.id, 'unitName', p.unit);
                        }}
                        showDropdownOnEmpty={true}
                        emptyLabel={t('shared.universal_document_form_template.s34', "صنف جديد (يمكنك المتابعة بالاسم المدخل)")}
                      />
                    </td>
                    <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                      <input className="purchase-prototype-table-input" type="text" value={line.unitName} onChange={(e) => handleUpdateLine(line.id, 'unitName', e.target.value)} style={{ textAlign: 'center' }} />
                    </td>
                    <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                      <input className="purchase-prototype-table-input" type="text" value={line.warehouse || warehouseName} onChange={(e) => handleUpdateLine(line.id, 'warehouse', e.target.value)} style={{ textAlign: 'center' }} />
                    </td>
                    <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                      <input className="purchase-prototype-table-input" type="number" min="1" value={line.quantity} onChange={(e) => handleUpdateLine(line.id, 'quantity', Math.max(1, Number(e.target.value) || 1))} style={{ textAlign: 'center', fontWeight: 600 }} />
                    </td>
                    <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                      <input className="purchase-prototype-table-input" type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => handleUpdateLine(line.id, 'unitPrice', Math.max(0, Number(e.target.value) || 0))} style={{ textAlign: 'center', fontWeight: 600 }} />
                    </td>
                    <td className="line-total" style={{ textAlign: 'center', fontWeight: 700, color: '#170e5e' }}>
                      {formatCurrencyWithSymbol(line.total || 0, currency)}
                    </td>
                    <td className="purchase-prototype-table-cell purchase-prototype-table-cell-actions" style={{ textAlign: 'center' }}>
                      <button type="button" className="document-row-delete purchase-prototype-row-delete" onClick={() => handleRemoveItem(line.id)} disabled={items.length === 1}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="document-line-items-actions" style={{ marginTop: '12px' }}>
            <Button type="button" variant="dashedAction" onClick={handleAddItem}>
              <span aria-hidden="true">+</span>
              <span>{t('shared.universal_document_form_template.s35', "إضافة صنف")}</span>
            </Button>
            <Button type="button" variant="dashedAction" onClick={() => toast.info(t('shared.universal_document_form_template.s36', "فتح ماسح الباركود..."))}>
              <span aria-hidden="true" className="purchase-prototype-scan-icon">
                <svg viewBox="0 0 16 16" role="img" focusable="false" aria-hidden="true" width="14" height="14">
                  <path d="M3 4.2V3.1A.6.6 0 0 1 3.6 2.5h1.1M11.3 2.5h1.1a.6.6 0 0 1 .6.6v1.1M13 11.8v1.1a.6.6 0 0 1-.6.6h-1.1M4.7 13.5H3.6a.6.6 0 0 1-.6-.6v-1.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M5.1 5.2v5.6M7 5.2v5.6M9 5.2v5.6M10.9 5.2v5.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </span>
              <span>{t('shared.universal_document_form_template.s37', "مسح باركود")}</span>
            </Button>
            <Button type="button" variant="dashedAction" onClick={handleAddItem}>
              <span aria-hidden="true">+</span>
              <span>{t('shared.universal_document_form_template.s38', "منتج جديد")}</span>
            </Button>
          </div>
        </section>

        {/* Section 3: Advanced Operations */}
        <section className="document-prototype-section" style={{ marginTop: '12px' }}>
          <h3 className="document-prototype-section-title">{t('shared.universal_document_form_template.s39', "موديول الشركات والعمليات المتقدمة")}</h3>
          <div className="document-prototype-grid compact-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            <Field label={t('shared.universal_document_form_template.s40', "مستودع الاستلام (المخزن أو الفرع)")}>
              <input className="purchase-prototype-field-input" type="text" value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)} />
            </Field>
            <Field label={t('shared.universal_document_form_template.s41', "مركز التكلفة")}>
              <input className="purchase-prototype-field-input" type="text" disabled value={t('shared.universal_document_form_template.s42', "المركز الرئيسي - عام")} style={{ backgroundColor: '#f8fafc', color: '#64748b' }} />
            </Field>
            <Field label={t('shared.universal_document_form_template.s43', "المشروع")}>
              <input className="purchase-prototype-field-input" type="text" disabled value={t('shared.universal_document_form_template.s44', "عام / بدون مشروع محدد")} style={{ backgroundColor: '#f8fafc', color: '#64748b' }} />
            </Field>
          </div>
        </section>

        {/* Section 4: Terms & Conditions */}
        <section className="document-prototype-section" style={{ marginTop: '12px' }}>
          <h3 className="document-prototype-section-title">{t('shared.universal_document_form_template.s45', "الشروط والأحكام")}</h3>
          <textarea
            className="purchase-prototype-notes-textarea"
            rows={3}
            value={termsConditions}
            onChange={(e) => setTermsConditions(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
        </section>

        {/* Section 5: Notes & Totals */}
        <section className="document-prototype-bottom-grid" style={{ marginTop: '12px' }}>
          <div className="document-prototype-section">
            <h3 className="document-prototype-section-title">{t('shared.universal_document_form_template.s46', "ملاحظات")}</h3>
            <textarea
              className="purchase-prototype-notes-textarea"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('shared.universal_document_form_template.s47', "أي ملاحظات خاصة بالمعاملة...")}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          <div className="document-prototype-section document-totals-card">
            <h3 className="document-prototype-section-title">{t('shared.universal_document_form_template.s48', "الإجماليات")}</h3>
            <div className="document-totals-panel">
              <div>
                <span>{t('shared.universal_document_form_template.s49', "الإجمالي الفرعي:")}</span>
                <strong>{formatCurrencyWithSymbol(subtotal, currency)}</strong>
              </div>
              {discountTotal > 0 && (
                <div style={{ color: '#16a34a' }}>
                  <span>{t('shared.universal_document_form_template.s50', "الخصم:")}</span>
                  <strong>- {formatCurrencyWithSymbol(discountTotal, currency)}</strong>
                </div>
              )}
              <div>
                <span>{t('shared.universal_document_form_template.s51', "الضريبة (")}{taxRate}%):</span>
                <strong>{formatCurrencyWithSymbol(taxAmount, currency)}</strong>
              </div>
              <div className="document-total-grand" style={{ borderTop: '2px solid #e2e8f0', paddingTop: '8px', marginTop: '6px' }}>
                <span>{t('shared.universal_document_form_template.s52', "الإجمالي:")}</span>
                <strong>{formatCurrencyWithSymbol(totalAmount, currency)}</strong>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
