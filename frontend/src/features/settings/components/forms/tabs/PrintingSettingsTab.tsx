import { useTranslation } from 'react-i18next';
import { memo, type CSSProperties } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';
import { FormSection } from '@/shared/components/form-section';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { printSmallReceiptDocument } from '@/lib/small-receipt-printer';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';

const checkboxGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))',
  gap: '6px',
};

const checkboxStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 9px',
  borderRadius: '6px',
  border: '1px solid var(--border-color, #e2e8f0)',
  background: 'var(--surface-color, #ffffff)',
  cursor: 'pointer',
  fontSize: '11.5px',
  fontWeight: 600,
  color: 'var(--text-color, #334155)',
  userSelect: 'none',
  lineHeight: '1.3',
  transition: 'background 0.15s ease, border-color 0.15s ease',
};

const checkboxInputStyle: CSSProperties = {
  margin: 0,
  width: '15px',
  height: '15px',
  accentColor: 'var(--primary-color, #0284c7)',
  cursor: 'pointer',
};

const premiumCardStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  background: 'var(--surface-color, #ffffff)',
  border: '1px solid var(--border-color, #e2e8f0)',
  borderRadius: '8px',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
};

const premiumCardTextStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '2px',
};

const premiumCheckboxInputStyle = {
  width: '16px',
  height: '16px',
  accentColor: 'var(--primary-color, #0284c7)',
  cursor: 'pointer',
};

const groupCardStyle: React.CSSProperties = {
  background: 'var(--panel-subtle, rgba(248, 250, 252, 0.6))',
  border: '1px solid var(--border-color, #e2e8f0)',
  borderRadius: '8px',
  padding: '8px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const groupHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  borderBottom: '1px dashed var(--border-color, #e2e8f0)',
  paddingBottom: '5px',
};

const groupHeaderBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '18px',
  height: '18px',
  borderRadius: '4px',
  background: 'var(--primary-color, #0284c7)',
  color: '#ffffff',
  fontSize: '10px',
  fontWeight: 800,
};

const groupHeaderTitleStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--text-color, #1e293b)',
};

interface PrintingTabProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  activeTab: string;
  settings?: AppSettings;
  systemPrinters?: { name: string; displayName: string }[];
  savedCashierPrinter?: string;
  savedKitchenPrinter?: string;
  posKitchenPrinterEnabled?: boolean;
}

export const PrintingSettingsTab = memo(function PrintingSettingsTab({
  form,
  disabled,
  activeTab,
  settings,
  systemPrinters = [],
  savedCashierPrinter,
  savedKitchenPrinter,
  posKitchenPrinterEnabled,
}: PrintingTabProps) {
  const { t } = useTranslation();
  const rawActivity = String(form.watch('businessIndustry') || settings?.businessIndustry || (settings as any)?.activityType || 'retail_general').trim().toLowerCase();
  const isContractingVertical = rawActivity === 'contracting' || rawActivity === 'construction' || rawActivity === 'مقاولات' || Boolean(form.watch('contractingModuleEnabled'));
  const isMaritimeVertical = rawActivity === 'maritime_freight' || rawActivity === 'maritime' || rawActivity === 'freight' || rawActivity === 'shipping' || rawActivity === 'شحن' || Boolean(form.watch('maritimeFreightModuleEnabled'));
  const isManufacturingVertical = rawActivity === 'manufacturing' || rawActivity === 'production' || rawActivity === 'تصنيع' || rawActivity === 'مصنع' || Boolean(form.watch('manufacturingModuleEnabled'));
  const isServicesVertical = rawActivity === 'services' || rawActivity === 'consulting' || rawActivity === 'استشارات';
  const isNonPosVertical = isContractingVertical || isMaritimeVertical || isServicesVertical || isManufacturingVertical;
  const isPosModuleEnabled = Boolean(form.watch('posModuleEnabled') ?? settings?.posModuleEnabled ?? true);
  const showPosSettings = isPosModuleEnabled && !isNonPosVertical;
  const isRestaurantVertical = ['restaurant', 'cafe', 'مطعم', 'كافيه'].includes(rawActivity) || Boolean(form.watch('restaurantModuleEnabled'));

  return (
    <div style={{ display: activeTab === 'printing' ? 'block' : 'none' }}>
      {/* ===== 1. إعدادات الإيصال ونمط الفاتورة العامة ===== */}
      <FormSection
        title={isNonPosVertical ? t('settings.forms.tabs.printing_settings_tab.s0', "إعدادات نماذج المطبوعات والوثائق الرسمية") : t('settings.forms.tabs.printing_settings_tab.s1', "إعدادات الإيصال ونمط الفاتورة العامة")}
        description={isNonPosVertical ? t('settings.forms.tabs.printing_settings_tab.s2', "تحديد مقاس الورق (A4 القياسي للمشاريع والوثائق)، نمط الترقيم وتذييل المطبوعات الرسمية.") : t('settings.forms.tabs.printing_settings_tab.s3', "تحديد مقاس الورق وشكل الترقيم والتصميم والنصوص المطبوعة على الفاتورة.")}
      >
        <div className="document-prototype-grid compact-grid-2">
          <div className="field">
            <label>{t('settings.forms.tabs.printing_settings_tab.s4', "مقاس الطباعة الافتراضي")}</label>
            <CustomSelect
              value={form.watch('paperSize') || (isNonPosVertical ? 'a4' : 'receipt')}
              onChange={(val) => form.setValue('paperSize', val as any, { shouldDirty: true, shouldValidate: true })}
              options={
                isNonPosVertical
                  ? [
                      { value: 'a4', label: t('settings.forms.tabs.printing_settings_tab.s5', "ورق قياسي للمشاريع والوثائق (A4)") },
                      { value: 'receipt', label: t('settings.forms.tabs.printing_settings_tab.s6', "إيصال حراري (58/80mm)") },
                    ]
                  : [
                      { value: 'receipt', label: t('settings.forms.tabs.printing_settings_tab.s7', "إيصال حراري (58/80mm)") },
                      { value: 'a4', label: t('settings.forms.tabs.printing_settings_tab.s8', "ورق كبير قياسي (A4)") },
                    ]
              }
              disabled={disabled}
            />
          </div>

          {form.watch('paperSize') === 'receipt' && <div className="field">
            <label>{t('settings.forms.tabs.printing_settings_tab.s9', "عرض ورق الإيصال")}</label>
            <CustomSelect
              value={String(form.watch('receiptWidthMm') || 80)}
              onChange={(value) => form.setValue('receiptWidthMm', value === '58' ? 58 : 80, { shouldDirty: true, shouldValidate: true })}
              options={[{ value: '80', label: t('settings.forms.tabs.printing_settings_tab.s10', "80 مم") }, { value: '58', label: t('settings.forms.tabs.printing_settings_tab.s11', "58 مم") }]}
              disabled={disabled}
            />
          </div>}

          {showPosSettings && (
            <div className="field">
              <label>{t('settings.forms.tabs.printing_settings_tab.s12', "شكل وتصميم الإيصال (Receipt Theme)")}</label>
              <CustomSelect
                value={form.watch('posReceiptTheme') || 'boxed'}
                onChange={(val) => form.setValue('posReceiptTheme', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'boxed', label: t('settings.forms.tabs.printing_settings_tab.s13', "نمط المربعات (Boxed) — أنيق ومنظم") },
                  { value: 'classic', label: t('settings.forms.tabs.printing_settings_tab.s14', "النمط الكلاسيكي (Classic)") },
                  { value: 'ultra-compact', label: t('settings.forms.tabs.printing_settings_tab.s15', "نمط مصغر جداً لتوفير الورق (Ultra Compact)") },
                ]}
                disabled={disabled}
              />
            </div>
          )}

          <div className="field">
            <label>{t('settings.forms.tabs.printing_settings_tab.receipt_item_lang_mode', "نظام لغات أسماء الأصناف في الفواتير وشاشات الإدخال")}</label>
            <CustomSelect
              value={form.watch('receiptItemLanguageMode') || 'ar_only'}
              onChange={(val) => form.setValue('receiptItemLanguageMode', val as any, { shouldDirty: true, shouldValidate: true })}
              options={[
                { value: 'ar_only', label: t('settings.forms.tabs.printing_settings_tab.lang_ar_only', "عربي فقط — للمحلات والأنشطة المحلية في مصر (واجهة بسيطة بدون حقول إنجليزية)") },
                { value: 'ar_primary', label: t('settings.forms.tabs.printing_settings_tab.lang_ar_primary', "ثنائي اللغة: عربي أساسي (كبير) + إنجليزي تحته (أصغر) — قياسي للخليج") },
                { value: 'en_primary', label: t('settings.forms.tabs.printing_settings_tab.lang_en_primary', "ثنائي اللغة: إنجليزي أساسي (كبير) + عربي تحته (أصغر) — للبراندات والكافيهات") },
                { value: 'en_only', label: t('settings.forms.tabs.printing_settings_tab.lang_en_only', "إنجليزي فقط — للمناطق الحرة والشركات الدولية") },
              ]}
              disabled={disabled}
            />
            <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
              {t('settings.forms.tabs.printing_settings_tab.lang_help', "عند اختيار «عربي فقط»، يتم تبسيط شاشة إضافة الصنف وإخفاء خانة الإنجليزي تلقائياً لتسريع الإدخال على التجار المحليين.")}
            </small>
          </div>

          <div className="field">
            <label>{t('settings.forms.tabs.printing_settings_tab.s16', "نمط ترقيم الفواتير والمرتجعات")}</label>
            <CustomSelect
              value={form.watch('invoiceNumberingScheme') || 'daily'}
              onChange={(val) => form.setValue('invoiceNumberingScheme', val as any, { shouldDirty: true, shouldValidate: true })}
              options={[
                { value: 'daily', label: t('settings.forms.tabs.printing_settings_tab.s17', "ترقيم يومي مدمج بالتاريخ (Z-260818-0001)") },
                { value: 'sequential', label: t('settings.forms.tabs.printing_settings_tab.s18', "ترقيم تسلسلي كلاسيكي مستمر (Z-1, Z-2...)") },
              ]}
              disabled={disabled}
            />
          </div>

          <div className="field">
            <label>{t('settings.forms.tabs.printing_settings_tab.s19', "تنسيق أرقام الفاتورة المطبوعة")}</label>
            <CustomSelect
              value={form.watch('printNumberFormat') || 'arabic'}
              onChange={(val) => form.setValue('printNumberFormat', val as any, { shouldDirty: true, shouldValidate: true })}
              options={[
                { value: 'arabic', label: t('settings.forms.tabs.printing_settings_tab.s20', "أرقام عربية: ١٢٣٤") },
                { value: 'english', label: t('settings.forms.tabs.printing_settings_tab.s21', "أرقام إنجليزية: 1234") },
              ]}
              disabled={disabled}
            />
          </div>

          <div className="field">
            <label>{t('settings.forms.tabs.printing_settings_tab.s22', "تذييل الفاتورة المطبوعة")}</label>
            <input
              className="purchase-prototype-field-input"
              {...form.register('invoiceFooter')}
              disabled={disabled}
              placeholder={t('settings.forms.tabs.printing_settings_tab.s23', "مثال: شكراً لتعاملكم معنا ونسعد بزيارتكم دائماً")}
            />
          </div>

          <div className="field">
            <label>{t('settings.forms.tabs.printing_settings_tab.s24', "محتوى رمز QR في الفاتورة")}</label>
            <input
              className="purchase-prototype-field-input"
              {...form.register('invoiceQR')}
              disabled={disabled}
              placeholder={t('settings.forms.tabs.printing_settings_tab.s25', "رابط الموقع أو نص اختياري للـ QR")}
            />
          </div>
        </div>
      </FormSection>

      {/* ===== 2. عناصر وبيانات الفاتورة المطبوعة ===== */}
      <FormSection
        title={t('settings.forms.tabs.printing_settings_tab.s26', "عناصر وبيانات الفاتورة المطبوعة")}
        description={t('settings.forms.tabs.printing_settings_tab.s27', "حدد البيانات المطلوب إظهارها أو إخفاؤها من الإيصال المطبوع للكاشير مقسمة حسب تسلسلها في الفاتورة.")}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '10px', alignItems: 'start' }}>

          {/* العمود الأول (يمين): بيانات المتجر والفرع + بيانات المستند والعملية */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* 1. رأس المتجر والفرع */}
            <div style={groupCardStyle}>
              <div style={groupHeaderStyle}>
                <span style={groupHeaderBadgeStyle}>1</span>
                <strong style={groupHeaderTitleStyle}>{t('settings.forms.tabs.printing_settings_tab.s28', "بيانات المتجر والفرع (الرأس بالأعلى)")}</strong>
              </div>
              <div className="settings-print-options-grid" style={checkboxGridStyle}>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowLogo')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s29', "إظهار الشعار")}
                </label>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowPhone')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s30', "إظهار الهاتف")}
                </label>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowAddress')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s31', "إظهار العنوان")}
                </label>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowTaxNumber')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s32', "إظهار الرقم الضريبي")}
                </label>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowBranch')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s33', "إظهار الفرع")}
                </label>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowLocation')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s34', "إظهار المخزن")}
                </label>
              </div>
            </div>

            {/* 2. بيانات الفاتورة والعملية */}
            <div style={groupCardStyle}>
              <div style={groupHeaderStyle}>
                <span style={groupHeaderBadgeStyle}>2</span>
                <strong style={groupHeaderTitleStyle}>{t('settings.forms.tabs.printing_settings_tab.s35', "بيانات المستند والعملية")}</strong>
              </div>
              <div className="settings-print-options-grid" style={checkboxGridStyle}>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowDocumentType')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s36', "إظهار نوع المستند")}
                </label>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowDocumentNumber')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s37', "إظهار رقم المستند")}
                </label>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowDate')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s38', "إظهار تاريخ ووقت الفاتورة")}
                </label>
                <label className="settings-print-option" style={{ ...checkboxStyle, gridColumn: 'span 2' }}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowHijriDate')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s39', "إظهار التقويم الهجري (أم القرى)")}
                </label>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowOrderType')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s40', "إظهار نوع الطلب")}
                </label>
                {showPosSettings && (
                  <>
                    <label className="settings-print-option" style={checkboxStyle}>
                      <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowCashier')} disabled={disabled} />
                      {t('settings.forms.tabs.printing_settings_tab.s41', "إظهار الكاشير")}
                    </label>
                    <label className="settings-print-option" style={checkboxStyle}>
                      <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowDeliveryCustomerDetails')} disabled={disabled} />
                      {t('settings.forms.tabs.printing_settings_tab.s42', "تفاصيل العميل في الدليفري")}
                    </label>
                    <label className="settings-print-option" style={checkboxStyle}>
                      <input type="checkbox" style={checkboxInputStyle} {...form.register('printDeliveryRepOnReceipt')} disabled={disabled} />
                      {t('settings.forms.tabs.printing_settings_tab.s43', "إظهار اسم المندوب")}
                    </label>
                    <label className="settings-print-option" style={{ ...checkboxStyle, gridColumn: '1 / -1' }}>
                      <input type="checkbox" style={checkboxInputStyle} {...form.register('printDualReceiptForOnlineDelivery')} disabled={disabled} />
                      {t('settings.forms.tabs.printing_settings_tab.s44', "طباعة نسختين تلقائياً للدليفري والدفع الإلكتروني (عميل + محل)")}
                    </label>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* العمود الثاني (يسار): الأصناف والعروض + الإجماليات + التذييل والنمط */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* 3. الأصناف وعروض التخفيض (لنقاط البيع والتجزئة) */}
            {showPosSettings && (
              <div style={groupCardStyle}>
                <div style={groupHeaderStyle}>
                  <span style={groupHeaderBadgeStyle}>3</span>
                  <strong style={groupHeaderTitleStyle}>{t('settings.forms.tabs.printing_settings_tab.s45', "الأصناف وعروض التخفيض")}</strong>
                </div>
                <div className="settings-print-options-grid" style={checkboxGridStyle}>
                  <label className="settings-print-option" style={{ ...checkboxStyle, gridColumn: '1 / -1' }}>
                    <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowItemOffers')} disabled={disabled} />
                    {t('settings.forms.tabs.printing_settings_tab.s46', "إظهار عروض الأصناف (عرض: X بدلاً من Y)")}
                  </label>
                  <label className="settings-print-option" style={{ ...checkboxStyle, gridColumn: '1 / -1' }}>
                    <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowDiscountBreakdown')} disabled={disabled} />
                    {t('settings.forms.tabs.printing_settings_tab.s47', "تفصيل سطور الخصومات في الإجماليات")}
                  </label>
                  <label className="settings-print-option" style={{ ...checkboxStyle, gridColumn: '1 / -1' }}>
                    <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowSavingsBanner')} disabled={disabled} />
                    {t('settings.forms.tabs.printing_settings_tab.s48', "إظهار شريط إجمالي التوفير بالفاتورة")}
                  </label>
                  <label className="settings-print-option" style={{ ...checkboxStyle, gridColumn: '1 / -1' }}>
                    <input type="checkbox" style={checkboxInputStyle} {...form.register('printBilingualItemNames')} disabled={disabled} />
                    {t('settings.forms.tabs.printing_settings_tab.print_bilingual_names', "طباعة الاسم الثنائي للأصناف (عربي + إنجليزي)")}
                  </label>
                </div>
              </div>
            )}

            {/* 4. الإجماليات والملخص */}
            <div style={groupCardStyle}>
              <div style={groupHeaderStyle}>
                <span style={groupHeaderBadgeStyle}>4</span>
                <strong style={groupHeaderTitleStyle}>{t('settings.forms.tabs.printing_settings_tab.s49', "الإجماليات والملخص")}</strong>
              </div>
              <div className="settings-print-options-grid" style={checkboxGridStyle}>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowTax')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s50', "إظهار الضريبة")}
                </label>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowItemCount')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s51', "إظهار عدد الأصناف")}
                </label>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowPiecesCount')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s52', "إظهار إجمالي القطع")}
                </label>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowPaymentBreakdown')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s53', "إظهار تفصيل المدفوعات")}
                </label>
              </div>
            </div>

            {/* 5. التذييل والنمط العام */}
            <div style={groupCardStyle}>
              <div style={groupHeaderStyle}>
                <span style={groupHeaderBadgeStyle}>5</span>
                <strong style={groupHeaderTitleStyle}>{t('settings.forms.tabs.printing_settings_tab.s54', "التذييل ونمط الإيصال (الأسفل)")}</strong>
              </div>
              <div className="settings-print-options-grid" style={checkboxGridStyle}>
                <label className="settings-print-option" style={{ ...checkboxStyle, gridColumn: '1 / -1' }}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowInvoiceBarcode')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s55', "إظهار شريط باركود الفاتورة (Code 128)")}
                </label>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printShowFooter')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s56', "إظهار التذييل")}
                </label>
                <label className="settings-print-option" style={checkboxStyle}>
                  <input type="checkbox" style={checkboxInputStyle} {...form.register('printCompactReceipt')} disabled={disabled} />
                  {t('settings.forms.tabs.printing_settings_tab.s57', "خطوط إيصال مضغوطة")}
                </label>
              </div>
            </div>
          </div>

        </div>
      </FormSection>

      {/* ===== 2b. طابعة الكاشير وفتح الدرج ===== */}
      {showPosSettings && (
        <FormSection
          title={t('settings.forms.tabs.printing_settings_tab.s173', "طابعة الكاشير وفتح الدرج")}
          description={t('settings.forms.tabs.printing_settings_tab.s174', "حدد ما إذا كانت هناك طابعة متصلة بدرج نقدية ليفتح الدرج تلقائياً بعد البيع النقدي.")}
        >
          <div className="document-prototype-grid compact-grid-2">
            <label style={premiumCardStyle}>
              <div style={premiumCardTextStyle}>
                <strong>{t('settings.forms.tabs.printing_settings_tab.s175', "طابعة كاشير متصلة بدرج نقدية")}</strong>
                <small className="muted">{t('settings.forms.tabs.printing_settings_tab.s176', "عند التفعيل يفتح الدرج تلقائياً بعد البيع النقدي عبر جهاز الجسر المحلي؛ أوقفها إذا لم تكن هناك طابعة متصلة.")}</small>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posCashDrawerPrinterEnabled')} disabled={disabled} />
            </label>
          </div>
        </FormSection>
      )}

      {/* ===== 3. طابعة وشيت المطبخ ومناداة العميل (KOT) ===== */}
      {(isRestaurantVertical || posKitchenPrinterEnabled) && (
        <FormSection
          title={t('settings.forms.tabs.printing_settings_tab.s58', "طابعة وشيت المطبخ ومناداة العميل (KOT)")}
          description={t('settings.forms.tabs.printing_settings_tab.s59', "إعدادات طباعة تذكرة التحضير بالمطبخ أو إيصال المناداة الصغير للعميل.")}
        >
          <div className="document-prototype-grid compact-grid-2">
            <label style={premiumCardStyle}>
              <div style={premiumCardTextStyle}>
                <strong>{t('settings.forms.tabs.printing_settings_tab.s60', "تفعيل طباعة شيت المطبخ (KOT)")}</strong>
                <small className="muted">{t('settings.forms.tabs.printing_settings_tab.s61', "تمكين خيار طباعة إيصال التحضير أو المناداة")}</small>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posKitchenPrinterEnabled')} disabled={disabled} />
            </label>

            <label style={premiumCardStyle}>
              <div style={premiumCardTextStyle}>
                <strong>{t('settings.forms.tabs.printing_settings_tab.s62', "طباعة شيت المطبخ تلقائياً")}</strong>
                <small className="muted">{t('settings.forms.tabs.printing_settings_tab.s63', "إرسال التذكرة للطابعة فور حفظ فاتورة البيع")}</small>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posKitchenPrinterAuto')} disabled={disabled} />
            </label>

            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>{t('settings.forms.tabs.printing_settings_tab.s64', "نوع شيت المطبخ المطلوب")}</label>
              <CustomSelect
                value={form.watch('posKitchenPrinterMode') || 'detailed'}
                onChange={(val) => form.setValue('posKitchenPrinterMode', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'detailed', label: t('settings.forms.tabs.printing_settings_tab.s65', "إيصال مطبخ مفصل (شامل قائمة الأصناف والإضافات)") },
                  { value: 'mini', label: t('settings.forms.tabs.printing_settings_tab.s66', "إيصال مصغر لتوفير الورق (رقم الطلب فقط لمناداة العميل)") },
                ]}
                disabled={disabled || !posKitchenPrinterEnabled}
              />
            </div>

            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>{t('settings.forms.tabs.printing_settings_tab.kitchen_language', "لغة طباعة بون المطبخ (Kitchen Language)")}</label>
              <CustomSelect
                value={form.watch('posKitchenLanguage') || 'dual'}
                onChange={(val) => form.setValue('posKitchenLanguage', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'dual', label: t('settings.forms.tabs.printing_settings_tab.kitchen_lang_dual', "ثنائي (عربي + إنجليزي) - الخيار الموصى به لكافة أطقم المطبخ") },
                  { value: 'en', label: t('settings.forms.tabs.printing_settings_tab.kitchen_lang_en', "الإنجليزية فقط (English Only) - للعمالة الآسيوية والأجنبية") },
                  { value: 'ar', label: t('settings.forms.tabs.printing_settings_tab.kitchen_lang_ar', "العربية فقط (Arabic Only)") },
                ]}
                disabled={disabled || !posKitchenPrinterEnabled}
              />
            </div>

            {typeof window !== 'undefined' && (window as any).electronPrinter && (
              <div
                key={`printers-${String(settings?.posElectronCashierPrinter || '')}-${String(settings?.posElectronKitchenPrinter || '')}-${systemPrinters.length}`}
                className="document-prototype-grid compact-grid-2"
                style={{ gridColumn: '1 / -1', marginTop: 8, padding: '12px', border: '1px solid var(--border)', borderRadius: 8, background: '#f8fafc' }}
              >
                <div className="field">
                  <label>{t('settings.forms.tabs.printing_settings_tab.s67', "طابعة الكاشير المباشرة (الريسيت)")}</label>
                  <CustomSelect
                    value={form.watch('posElectronCashierPrinter') || ''}
                    onChange={(val) => form.setValue('posElectronCashierPrinter', val, { shouldDirty: true, shouldValidate: true })}
                    options={[
                      { value: '', label: t('settings.forms.tabs.printing_settings_tab.s68', "- الطباعة العادية (نافذة المتصفح) -") },
                      ...(savedCashierPrinter && !systemPrinters.some((p: any) => p.name === savedCashierPrinter) ? [{ value: savedCashierPrinter, label: savedCashierPrinter }] : []),
                      ...systemPrinters.map((p: any) => ({ value: p.name, label: p.displayName || p.name })),
                    ]}
                    disabled={disabled}
                  />
                </div>

                <div className="field">
                  <label>{t('settings.forms.tabs.printing_settings_tab.s69', "طابعة المطبخ المباشرة (KOT)")}</label>
                  <CustomSelect
                    value={form.watch('posElectronKitchenPrinter') || ''}
                    onChange={(val) => form.setValue('posElectronKitchenPrinter', val, { shouldDirty: true, shouldValidate: true })}
                    options={[
                      { value: '', label: t('settings.forms.tabs.printing_settings_tab.s70', "- الطباعة العادية (نافذة المتصفح) -") },
                      ...(savedKitchenPrinter && !systemPrinters.some((p: any) => p.name === savedKitchenPrinter) ? [{ value: savedKitchenPrinter, label: savedKitchenPrinter }] : []),
                      ...systemPrinters.map((p: any) => ({ value: p.name, label: p.displayName || p.name })),
                    ]}
                    disabled={disabled || !posKitchenPrinterEnabled}
                  />
                </div>

                <div className="muted small" style={{ gridColumn: '1 / -1' }}>
                  <strong>{t('settings.forms.tabs.printing_settings_tab.s71', "معلومة:")}</strong> {t('settings.forms.tabs.printing_settings_tab.s72', "إذا اخترت طابعة هنا، سيتم إرسال الطباعة")} <b>{t('settings.forms.tabs.printing_settings_tab.s73', "مباشرة وبدون أي شاشة تأكيد")}</b>{t('settings.forms.tabs.printing_settings_tab.s74', ".\n                  ولو اخترت")} <b>{t('settings.forms.tabs.printing_settings_tab.s75', "نفس الطابعة")}</b> {t('settings.forms.tabs.printing_settings_tab.s76', "للكاشير والمطبخ، سيتم طباعة الإيصالين ورا بعد تلقائياً.")}
                </div>
              </div>
            )}
          </div>
        </FormSection>
      )}

      {/* ===== 4. مصمم ومعاين الفاتورة البصري التفاعلي (Visual Receipt Designer & Live Mockup) ===== */}
      {/* ===== 4. مصمم ومعاين الفاتورة البصري التفاعلي (Visual Document Preview & Mockup) ===== */}
      <FormSection
        title={
          isMaritimeVertical
            ? t('settings.forms.tabs.printing_settings_tab.s77', "معاين ومصمم وثائق وفواتير الشحن الملاحي (Maritime Freight Invoice Preview)")
            : isContractingVertical
            ? t('settings.forms.tabs.printing_settings_tab.s78', "معاين ومصمم مستخلصات المشروعات الهندسية (Contracting IPC Preview)")
            : t('settings.forms.tabs.printing_settings_tab.s79', "مصمم ومعاين الفاتورة البصري التفاعلي (Visual Receipt Preview)")
        }
        description={
          isMaritimeVertical
            ? t('settings.forms.tabs.printing_settings_tab.s80', "معاينة حية ومباشرة لشكل فاتورة الشحن والنولون الرسمية بمقاس A4 وتذييل البوالص الملاحية.")
            : isContractingVertical
            ? t('settings.forms.tabs.printing_settings_tab.s81', "معاينة حية ومباشرة لشكل مستخلص الأعمال الدوري بمقاس A4 وتذييل الاستشاري والمالك.")
            : t('settings.forms.tabs.printing_settings_tab.s82', "معاينة حية ومباشرة لشكل الإيصال المطبوع مع إمكانية تجربة الطباعة الحية على طابعتك.")
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', alignItems: 'start' }}>
          {/* Mockup Card */}
          <div style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '12px',
            padding: '24px 16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}>
            {isMaritimeVertical ? (
              /* A4 Freight Invoice Mockup */
              <div style={{
                width: '100%',
                maxWidth: '460px',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '20px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                fontSize: '11px',
                color: '#0f172a',
                lineHeight: 1.5,
                boxSizing: 'border-box',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #170e5e', paddingBottom: '12px', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 900, color: '#170e5e' }}>{(settings as any)?.companyName || settings?.storeName || t('settings.forms.tabs.printing_settings_tab.s83', "شركة الملاحة والشحن الدولي")}</div>
                    <div style={{ fontSize: '10px', color: '#64748b' }}>{t('settings.forms.tabs.printing_settings_tab.s84', "الفرع الملاحي الرئيسي • ميناء الإسكندرية")}</div>
                    <div style={{ fontSize: '10px', color: '#64748b' }}>{t('settings.forms.tabs.printing_settings_tab.s85', "س.ت: 894120 • ت.ض: 456-789-012")}</div>
                  </div>
                  <div style={{ textAlign: 'left', direction: 'ltr' }}>
                    <span style={{ display: 'inline-block', background: '#e0f2fe', color: '#0369a1', padding: '3px 8px', borderRadius: '4px', fontWeight: 800, fontSize: '10px' }}>A4 OFFICIAL INVOICE</span>
                    <div style={{ fontSize: '10px', color: '#475569', marginTop: '4px' }}>INV-260818-0001</div>
                  </div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px', marginBottom: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '10px' }}>
                  <div><span>{t('settings.forms.tabs.printing_settings_tab.s86', "بوليصة الشحن (B/L):")}</span> <strong>BL-EGY-99412</strong></div>
                  <div><span>{t('settings.forms.tabs.printing_settings_tab.s87', "السفينة / الرحلة:")}</span> <strong>CMA CGM JULES - V.12</strong></div>
                  <div><span>{t('settings.forms.tabs.printing_settings_tab.s88', "ميناء الشحن (POL):")}</span> <strong>Alexandria Port (EGALY)</strong></div>
                  <div><span>{t('settings.forms.tabs.printing_settings_tab.s89', "ميناء التفريغ (POD):")}</span> <strong>Rotterdam (NLRTM)</strong></div>
                  <div><span>{t('settings.forms.tabs.printing_settings_tab.s90', "عدد الحاويات:")}</span> <strong>2 × 40HQ (FCL)</strong></div>
                  <div><span>{t('settings.forms.tabs.printing_settings_tab.s91', "فترة السماح (Demurrage):")}</span> <strong>{t('settings.forms.tabs.printing_settings_tab.s92', "14 يوم مجاني")}</strong></div>
                </div>

                {/* Items */}
                <div style={{ borderBottom: '1px solid #cbd5e1', paddingBottom: '8px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, borderBottom: '1px solid #e2e8f0', paddingBottom: '4px', marginBottom: '6px', color: '#334155' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s93', "الخدمة / البند اللوجستي")}</span>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s94', "العملة والفئة")}</span>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s95', "الإجمالي")}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', margin: '4px 0' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s96', "نولون شحن بحري (Ocean Freight - 40HQ)")}</span>
                    <span dir="ltr">2 × $1,200.00</span>
                    <span dir="ltr" style={{ fontWeight: 700 }}>$2,400.00</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', margin: '4px 0' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s97', "رسوم تفريغ ومناولة محطة الحاويات (THC)")}</span>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s98', "2 × 2,100 ج.م")}</span>
                    <span style={{ fontWeight: 700 }}>{t('settings.forms.tabs.printing_settings_tab.s99', "4,200.00 ج.م")}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', margin: '4px 0' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s100', "إذن تسليم وإجراءات ملاحية (Delivery Order)")}</span>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s101', "مقطوع")}</span>
                    <span style={{ fontWeight: 700 }}>{t('settings.forms.tabs.printing_settings_tab.s102', "1,500.00 ج.م")}</span>
                  </div>
                </div>

                {/* Totals */}
                <div style={{ borderBottom: '1px solid #cbd5e1', paddingBottom: '8px', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s103', "إجمالي النولون الأجنبي:")}</span>
                    <strong dir="ltr">$2,400.00</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s104', "إجمالي الخدمات المحلية:")}</span>
                    <strong>{t('settings.forms.tabs.printing_settings_tab.s105', "5,700.00 ج.م")}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s106', "ضريبة القيمة المضافة (14% على الخدمات):")}</span>
                    <strong>{t('settings.forms.tabs.printing_settings_tab.s107', "798.00 ج.م")}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 900, color: '#170e5e', marginTop: '4px', borderTop: '1px dashed #cbd5e1', paddingTop: '4px' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s108', "الصافي الإجمالي المستحق:")}</span>
                    <span dir="ltr">{t('settings.forms.tabs.printing_settings_tab.s109', "$2,400.00 + 6,498.00 ج.م")}</span>
                  </div>
                </div>

                {/* Footer Stamp */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                  <div style={{ fontSize: '9.5px', color: '#64748b' }}>
                    {form.watch('invoiceFooter') || t('settings.forms.tabs.printing_settings_tab.s110', "شكراً لتعاملكم مع خطوطنا وخدماتنا الملاحية.")}
                  </div>
                  <div style={{ border: '1px dashed #94a3b8', borderRadius: '4px', padding: '4px 10px', fontSize: '9px', color: '#475569', fontWeight: 700 }}>
                    {t('settings.forms.tabs.printing_settings_tab.s111', "ختم التوكيل الملاحي")}
                  </div>
                </div>
              </div>
            ) : isContractingVertical ? (
              /* A4 Contracting IPC Mockup */
              <div style={{
                width: '100%',
                maxWidth: '460px',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '20px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                fontSize: '11px',
                color: '#0f172a',
                lineHeight: 1.5,
                boxSizing: 'border-box',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #0369a1', paddingBottom: '12px', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 900, color: '#0369a1' }}>{(settings as any)?.companyName || settings?.storeName || t('settings.forms.tabs.printing_settings_tab.s112', "شركة المقاولات العامة والإنشاءات")}</div>
                    <div style={{ fontSize: '10px', color: '#64748b' }}>{t('settings.forms.tabs.printing_settings_tab.s113', "مشروع: أبراج العاصمة الإدارية • مقاولة عامة")}</div>
                  </div>
                  <div style={{ textAlign: 'left', direction: 'ltr' }}>
                    <span style={{ display: 'inline-block', background: '#f0fdf4', color: '#166534', padding: '3px 8px', borderRadius: '4px', fontWeight: 800, fontSize: '10px' }}>IPC PROGRESS INVOICE</span>
                    <div style={{ fontSize: '10px', color: '#475569', marginTop: '4px' }}>IPC-260818-0004</div>
                  </div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px', marginBottom: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '10px' }}>
                  <div><span>{t('settings.forms.tabs.printing_settings_tab.s114', "رقم العقد:")}</span> <strong>CTR-2026-091</strong></div>
                  <div><span>{t('settings.forms.tabs.printing_settings_tab.s115', "شهادة الدفع:")}</span> <strong>AIA G702 / G703</strong></div>
                  <div><span>{t('settings.forms.tabs.printing_settings_tab.s116', "جهة الإسناد:")}</span> <strong>{t('settings.forms.tabs.printing_settings_tab.s117', "الهيئة الهندسية للتطوير")}</strong></div>
                  <div><span>{t('settings.forms.tabs.printing_settings_tab.s118', "نسبة الإنجاز الإجمالية:")}</span> <strong>64.5%</strong></div>
                </div>

                <div style={{ borderBottom: '1px solid #cbd5e1', paddingBottom: '8px', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s119', "إجمالي الأعمال المنجزة (GWD):")}</span>
                    <strong>{t('settings.forms.tabs.printing_settings_tab.s120', "1,450,000.00 ج.م")}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#b91c1c' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s121', "استقطاع الدفعة المقدمة (10%):")}</span>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s122', "-145,000.00 ج.م")}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#b91c1c' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s123', "ضمان الأعمال المحتجز (Retention 5%):")}</span>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s124', "-72,500.00 ج.م")}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 900, color: '#0369a1', marginTop: '4px', borderTop: '1px dashed #cbd5e1', paddingTop: '4px' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s125', "الصافي المستحق للصرف:")}</span>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s126', "1,232,500.00 ج.م")}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                  <div style={{ fontSize: '9.5px', color: '#64748b' }}>
                    {form.watch('invoiceFooter') || t('settings.forms.tabs.printing_settings_tab.s127', "المستخلص معتمد ومطابق للمواصفات الهندسية وجداول الكميات.")}
                  </div>
                  <div style={{ border: '1px dashed #94a3b8', borderRadius: '4px', padding: '4px 10px', fontSize: '9px', color: '#475569', fontWeight: 700 }}>
                    {t('settings.forms.tabs.printing_settings_tab.s128', "اعتماد الاستشاري")}
                  </div>
                </div>
              </div>
            ) : (
              /* POS / Retail Receipt Mockup */
              <div style={{
                width: (form.watch('paperSize') || 'receipt') === 'a4' ? '100%' : '300px',
                maxWidth: '320px',
                background: '#ffffff',
                border: '1px dashed #94a3b8',
                borderRadius: '4px',
                padding: '16px 14px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                fontFamily: 'monospace, sans-serif',
                fontSize: '11px',
                color: '#0f172a',
                lineHeight: 1.4,
                boxSizing: 'border-box',
              }}>
                <div style={{ textAlign: 'center', borderBottom: '1px dashed #cbd5e1', paddingBottom: '10px', marginBottom: '10px' }}>
                  <div style={{ fontSize: '15px', fontWeight: 900 }}>{settings?.storeName || t('settings.forms.tabs.printing_settings_tab.s129', "متجر Z-Systems التجريبي")}</div>
                  <div style={{ fontSize: '10px', color: '#64748b' }}>{t('settings.forms.tabs.printing_settings_tab.s130', "الفرع الرئيسي • القاهرة")}</div>
                  <div style={{ fontSize: '10px', color: '#64748b' }}>{t('settings.forms.tabs.printing_settings_tab.s131', "س.ت: 123456 • ت.ض: 987654321")}</div>
                  <div style={{ marginTop: '6px', fontSize: '11px', fontWeight: 700 }}>{t('settings.forms.tabs.printing_settings_tab.s132', "فاتورة ضريبية مبسطة")}</div>
                  <div style={{ fontSize: '10px', color: '#475569' }}>{t('settings.forms.tabs.printing_settings_tab.s133', "رقم: #Z-260818-0001 •")} {new Date().toLocaleDateString('ar-EG')}</div>
                </div>

                <div style={{ borderBottom: '1px dashed #cbd5e1', paddingBottom: '8px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderBottom: '1px solid #e2e8f0', paddingBottom: '4px', marginBottom: '4px' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s134', "الصنف")}</span>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s135', "الكمية × السعر")}</span>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s136', "الإجمالي")}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', margin: '3px 0' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s137', "صنف تجريبي 1")}</span>
                    <span>2 × 50.00</span>
                    <span>100.00</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', margin: '3px 0' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s138', "صنف تجريبي 2")}</span>
                    <span>1 × 150.00</span>
                    <span>150.00</span>
                  </div>
                </div>

                <div style={{ borderBottom: '1px dashed #cbd5e1', paddingBottom: '8px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s139', "المجموع الفرعي:")}</span>
                    <span>250.00 <CurrencySymbol /></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s140', "ضريبة القيمة المضافة (14%):")}</span>
                    <span>35.00 <CurrencySymbol /></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#b45309' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s141', "خصم نقاط الولاء:")}</span>
                    <span>-20.00 <CurrencySymbol /></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 900, marginTop: '4px' }}>
                    <span>{t('settings.forms.tabs.printing_settings_tab.s142', "الصافي النهائي:")}</span>
                    <span>265.00 <CurrencySymbol /></span>
                  </div>
                </div>

                <div style={{ textAlign: 'center', marginTop: '10px' }}>
                  <div style={{
                    display: 'inline-block',
                    padding: '6px',
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    marginBottom: '8px'
                  }}>
                    <span style={{ fontSize: '9px', fontWeight: 700, color: '#475569' }}>{t('settings.forms.tabs.printing_settings_tab.s143', "[ رمز QR المشفر ]")}</span>
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b' }}>
                    {form.watch('invoiceFooter') || t('settings.forms.tabs.printing_settings_tab.s144', "شكراً لتعاملكم معنا ونسعد بزيارتكم دائماً")}
                  </div>
                </div>
              </div>
            )}

            {/* Test Print Action */}
            <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  const footerText = form.getValues('invoiceFooter') || (isMaritimeVertical ? t('settings.forms.tabs.printing_settings_tab.s145', "شكراً لتعاملكم مع خطوطنا وخدماتنا الملاحية.") : t('settings.forms.tabs.printing_settings_tab.s146', "شكراً لتعاملكم معنا ونسعد بزيارتكم دائماً"));
                  if (isMaritimeVertical || isContractingVertical) {
                    window.print();
                    return;
                  }
                  const testHtml = `
                    <div style="text-align: center; border-bottom: 1px dashed #000; padding-bottom: 6px; margin-bottom: 6px;">
                      <h2 style="margin: 0; font-size: 14px;">${settings?.storeName || 'Z-Systems Store'}</h2>
                      <p style="margin: 2px 0; font-size: 10px;">فاتورة تجريبية لاختبار مقاس الطابعة</p>
                      <p style="margin: 0; font-size: 10px;">#TEST-001 • ${new Date().toLocaleDateString('ar-EG')}</p>
                    </div>
                    <div style="font-size: 11px; border-bottom: 1px dashed #000; padding-bottom: 6px; margin-bottom: 6px;">
                      <div style="display: flex; justify-content: space-between;"><span>صنف تجريبي A (x2)</span><span>100.00 <CurrencySymbol /></span></div>
                      <div style="display: flex; justify-content: space-between;"><span>صنف تجريبي B (x1)</span><span>150.00 <CurrencySymbol /></span></div>
                    </div>
                    <div style="font-size: 12px; font-weight: bold; display: flex; justify-content: space-between; margin-bottom: 6px;">
                      <span>الإجمالي الصافي:</span><span>250.00 <CurrencySymbol /></span>
                    </div>
                    <div style="text-align: center; font-size: 10px; border-top: 1px dashed #000; padding-top: 6px;">
                      ${footerText}
                    </div>
                  `;
                  printSmallReceiptDocument(testHtml, { title: t('settings.forms.tabs.printing_settings_tab.s147', "إيصال تجريبي"), widthMm: form.getValues('receiptWidthMm') === 58 ? 58 : 80 });
                }}
                style={{
                  background: '#170e5e',
                  color: '#ffffff',
                  padding: '8px 18px',
                  fontSize: '12px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                {isNonPosVertical ? t('settings.forms.tabs.printing_settings_tab.s148', "معاينة وطباعة تجريبية A4") : t('settings.forms.tabs.printing_settings_tab.s149', "طباعة تجريبية حية (Test Print)")}
              </Button>
            </div>
          </div>

          {/* Quick Guidance */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
              <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block', marginBottom: '6px' }}>
                {isMaritimeVertical
                  ? t('settings.forms.tabs.printing_settings_tab.s150', "إرشادات طباعة وثائق ومستندات الشحن والنولون (A4)")
                  : isContractingVertical
                  ? t('settings.forms.tabs.printing_settings_tab.s151', "إرشادات طباعة مستخلصات المشروعات الهندسية (A4)")
                  : t('settings.forms.tabs.printing_settings_tab.s152', "نصائح لضبط مقاس الطابعات الحرارية")}
              </strong>
              {isMaritimeVertical ? (
                <ul style={{ margin: 0, paddingRight: '20px', fontSize: '12px', color: '#64748b', lineHeight: 1.7 }}>
                  <li>{t('settings.forms.tabs.printing_settings_tab.s153', "مقاس")} <b>A4</b> {t('settings.forms.tabs.printing_settings_tab.s154', "هو المقاس القياسي الدولي لكافة فواتير النولون وبوالص الشحن (B/L) وأذون التسليم.")}</li>
                  <li>{t('settings.forms.tabs.printing_settings_tab.s155', "تدعم المنظومة التصدير الفوري بصيغة")} <b>{t('settings.forms.tabs.printing_settings_tab.s156', "PDF رسمية")}</b> {t('settings.forms.tabs.printing_settings_tab.s157', "أو الطباعة على كافة طابعات الليزر المكتبية (HP, Canon, Xerox).")}</li>
                  <li>{t('settings.forms.tabs.printing_settings_tab.s158', "تتضمن الفاتورة تلقائياً أرقام الحاويات، السفينة، الرحلة، وميناءي الشحن والتفريغ.")}</li>
                  <li>{t('settings.forms.tabs.printing_settings_tab.s159', "يمكنك تخصيص الشعار وتذييل المطبوعات الرسمية من تبويب الهوية والمؤسسة.")}</li>
                </ul>
              ) : isContractingVertical ? (
                <ul style={{ margin: 0, paddingRight: '20px', fontSize: '12px', color: '#64748b', lineHeight: 1.7 }}>
                  <li>{t('settings.forms.tabs.printing_settings_tab.s160', "مقاس")} <b>A4</b> {t('settings.forms.tabs.printing_settings_tab.s161', "هو المقاس الهندسي المعتمد لجداول الكميات وشهادات الدفع والمستخلصات (AIA G702).")}</li>
                  <li>{t('settings.forms.tabs.printing_settings_tab.s162', "تتضمن الوثيقة تفصيل الأعمال المنجزة والاستقطاعات التعاقدية (الدفعة المقدمة وضمان الأعمال).")}</li>
                  <li>{t('settings.forms.tabs.printing_settings_tab.s163', "تجهيز خانات مخصصة لختم وتوقيع مهندس الموقع، الاستشاري، والجهة المالكة.")}</li>
                  <li>{t('settings.forms.tabs.printing_settings_tab.s164', "تصدير فوري بصيغة PDF وتجهيز ملفات الأرشفة الهندسية.")}</li>
                </ul>
              ) : (
                <ul style={{ margin: 0, paddingRight: '20px', fontSize: '12px', color: '#64748b', lineHeight: 1.7 }}>
                  <li>{t('settings.forms.tabs.printing_settings_tab.s165', "مقاس")} <b>80mm</b> {t('settings.forms.tabs.printing_settings_tab.s166', "هو المقاس القياسي لمعظم طابعات الكاشير المكتفية (Epson, Xprinter, Rongta).")}</li>
                  <li>{t('settings.forms.tabs.printing_settings_tab.s167', "مقاس")} <b>58mm</b> {t('settings.forms.tabs.printing_settings_tab.s168', "مناسب للطابعات المحمولة عبر البلوتوث وطابعات مناديب التوصيل.")}</li>
                  <li>{t('settings.forms.tabs.printing_settings_tab.s169', "تأكد من ضبط هوامش الورق في المتصفح على")} <b>{t('settings.forms.tabs.printing_settings_tab.s170', "\"None\" (بلا هوامش)")}</b> {t('settings.forms.tabs.printing_settings_tab.s171', "للحصول على أفضل محاذاة.")}</li>
                  <li>{t('settings.forms.tabs.printing_settings_tab.s172', "يمكنك معاينة التغييرات فورياً في النموذج المقابل وتجربة الطباعة المباشرة بضغطة زر.")}</li>
                </ul>
              )}
            </div>
          </div>
        </div>
      </FormSection>
    </div>
  );
}, (prev, next) => {
  if (prev.activeTab !== 'printing' && next.activeTab !== 'printing') {
    return true;
  }
  return false;
});
