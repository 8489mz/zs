// Sales-inventory vertical sections (contracting + maritime + import +
// services + manufacturing) — pure move from SalesInventorySettingsTab.tsx
// (slice S1). Five section components, one per vertical; each renders its
// FormSection whole. `t` is local — each component calls useTranslation()
// itself (section titles use the local `t` instead of the facade `__t`). Gate wrappers stay in
// the facade: the facade renders each section inside `{isXVertical && (...)}`
// and passes form/disabled/settings as props. The gate flags are NOT props —
// no section body reads its flag (grep 0 in all 5 bodies). `settings` is
// carried in the props interface (uniform tab-props shape; S0 precedent) but
// not destructured — no S1 body reads it as code (all word hits are string
// literals). Shared icons + styles come from the shared slice via `@/`
// (shared merges first).

import { useTranslation } from 'react-i18next';
import { FormSection } from '@/shared/components/form-section';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  ZeroCostIcon,
  LowStockIndicatorIcon,
  NegativeStockIcon,
  premiumCardStyle,
  iconBadgeStyle,
  premiumCardTextStyle,
  premiumCheckboxInputStyle,
  fieldControlStyle,
} from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-shared';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';

export interface SalesInventoryVerticalsProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  settings?: AppSettings;
}

function RetentionShieldIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function AdvanceRecoveryIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function TenderMarginIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function BoqLinkIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function DemurrageClockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function LandedCostIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

export function ContractingVerticalSection({ form, disabled }: SalesInventoryVerticalsProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* ===== مخصص لشركات المقاولات والمشاريع (Contracting Dedicated) ===== */}
        <FormSection
          title={t('settings.forms.tabs.sales_inventory_settings_tab.s41', "ضوابط مشاريع المقاولات والمستخلصات والتسعير (BOQ & IPC Controls)")}
          description={t('settings.forms.tabs.sales_inventory_settings_tab.s42', "تحديد القواعد المالية والتشغيلية لمشاريع المقاولات، نسب ضمان الأعمال المحتجزة، استقطاع الدفعة المقدمة، وهوامش تسعير العطاءات.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
            {/* Card 1: Retention Percent */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={iconBadgeStyle}>
                  <RetentionShieldIcon size={20} />
                </div>
                <div>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s43', "نسبة دفعة ضمان الأعمال المحتجزة (Retention %)")}</strong>
                  <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s44', "النسبة المحتجزة تلقائياً من المستخلص لصالح فترة الضمان والصيانة")}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="100"
                  className="purchase-prototype-field-input"
                  {...form.register('contractingRetentionPercent')}
                  disabled={disabled}
                  placeholder="5"
                  style={{ ...fieldControlStyle, width: '100px', textAlign: 'center', fontWeight: 800 }}
                />
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s45', "% (النسبة الشائعة 5% - 10%)")}</span>
              </div>
            </div>

            {/* Card 2: Advance Payment Recovery Mode */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={iconBadgeStyle}>
                  <AdvanceRecoveryIcon size={20} />
                </div>
                <div>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s46', "استقطاع الدفعة المقدمة من المستخلصات")}</strong>
                  <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s47', "طريقة إهلاك وخصم الدفعة المقدمة من مستخلصات التنفيذ")}</span>
                </div>
              </div>
              <CustomSelect
                value={form.watch('contractingAdvanceRecoveryMode') || 'proportional'}
                onChange={(val) => form.setValue('contractingAdvanceRecoveryMode', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'proportional', label: t('settings.forms.tabs.sales_inventory_settings_tab.s48', "خصم نسبي تلقائي حسب نسبة إنجاز المستخلص") },
                  { value: 'fixed', label: t('settings.forms.tabs.sales_inventory_settings_tab.s49', "مبلغ قطعي محدد لكل مستخلص") },
                ]}
                disabled={disabled}
              />
            </div>

            {/* Card 3: Tender Pricing Margins (Profit, Overhead, Waste) */}
            <div style={{ gridColumn: '1 / -1', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={iconBadgeStyle}>
                  <TenderMarginIcon size={20} />
                </div>
                <div>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s50', "هوامش ونسب التسعير الافتراضية لدراسة العطاءات (Tender Estimator)")}</strong>
                  <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s51', "النسب المعتمدة افتراضياً في حاسبة تسعير بنود المقايسة لتوليد سعر الوحدة التنافسي")}</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s52', "هامش الربح المستهدف (Profit %)")}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      className="purchase-prototype-field-input"
                      {...form.register('contractingDefaultProfitMargin')}
                      disabled={disabled}
                      placeholder="15"
                      style={{ ...fieldControlStyle, textAlign: 'center', fontWeight: 800 }}
                    />
                    <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#475569' }}>%</span>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s53', "المصاريف الإدارية والعمومية (Overhead %)")}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      className="purchase-prototype-field-input"
                      {...form.register('contractingDefaultOverhead')}
                      disabled={disabled}
                      placeholder="7"
                      style={{ ...fieldControlStyle, textAlign: 'center', fontWeight: 800 }}
                    />
                    <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#475569' }}>%</span>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s54', "نسبة الهالك المتوقع للمواد (Waste %)")}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      className="purchase-prototype-field-input"
                      {...form.register('contractingDefaultWaste')}
                      disabled={disabled}
                      placeholder="5"
                      style={{ ...fieldControlStyle, textAlign: 'center', fontWeight: 800 }}
                    />
                    <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#475569' }}>%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 4: Require BOQ Link for Site Issuance */}
            <label style={{ ...premiumCardStyle, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                <div style={iconBadgeStyle}>
                  <BoqLinkIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s55', "اشتراط ربط إذن الصرف ببند مقايسة محدد")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s56', "منع صرف أي مواد من مخازن المشاريع دون تحديد بند الأعمال أو المقايسة المرتبط بالصرف لمطابقة تكاليف التنفيذ")}
                  </small>
                </div>
              </div>
              <input
                type="checkbox"
                style={premiumCheckboxInputStyle}
                {...form.register('contractingRequireBoqLinkForIssue')}
                disabled={disabled}
              />
            </label>

            {/* Card 5: Zero Purchase Cost (Client-Supplied Materials) */}
            <label style={{ ...premiumCardStyle, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                <div style={iconBadgeStyle}>
                  <ZeroCostIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s57', "السماح بتوريدات بتكلفة شراء صفر")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s58', "مخصص للمواد الموردة من المالك والعميل مباشرة (Client-Supplied Items) أو العينات الفنية المجانية للاستشاري")}
                  </small>
                </div>
              </div>
              <input
                type="checkbox"
                style={premiumCheckboxInputStyle}
                {...form.register('allowZeroPurchaseCost')}
                disabled={disabled}
              />
            </label>

            {/* Card 6: Site Stock Low Threshold */}
            <div style={{ ...premiumCardStyle, cursor: 'default', gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                <div style={iconBadgeStyle}>
                  <LowStockIndicatorIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s59', "حد الأمان لنقص تشوينات الموقع")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s60', "يظهر تنبيه نواقص تشوين عندما يصل رصيد المادة بمخزن الموقع لهذا الحد أو أقل لتفادي تعطل الصب والأعمال الميدانية")}
                  </small>
                </div>
              </div>
              <input
                className="purchase-prototype-field-input"
                type="number"
                min="0"
                {...form.register('lowStockThreshold')}
                disabled={disabled}
                placeholder="5"
                style={{ width: '80px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
          </div>
        </FormSection>
    </>
  );
}

export function MaritimeVerticalSection({ form, disabled }: SalesInventoryVerticalsProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* ===== مخصص لشركات الشحن واللوجستيات (Maritime Dedicated) ===== */}
        <FormSection
          title={t('settings.forms.tabs.sales_inventory_settings_tab.s61', "ضوابط الشحن الدولي والعمليات الملاحية (Maritime Operations)")}
          description={t('settings.forms.tabs.sales_inventory_settings_tab.s62', "تحديد العملة الافتراضية لفواتير الشحن والنولون، وأيام السماح لغرامات الأرضيات والحاويات (Demurrage & Detention).")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={iconBadgeStyle}>
                  <DemurrageClockIcon size={20} />
                </div>
                <div>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s63', "أيام السماح المجانية للحاويات (Demurrage Free Days)")}</strong>
                  <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s64', "عدد الأيام المسموح بها في الميناء قبل بدء احتساب غرامات التأخير اليومية")}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  min="0"
                  max="365"
                  className="purchase-prototype-field-input"
                  {...form.register('maritimeDemurrageFreeDays')}
                  disabled={disabled}
                  placeholder="14"
                  style={{ ...fieldControlStyle, width: '100px', textAlign: 'center', fontWeight: 800 }}
                />
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s65', "يوم (الافتراضي 14 أو 21 يوماً)")}</span>
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s66', "عملة تسعير النولون والخدمات البحرية الافتراضية")}</strong>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s67', "العملة الأساسية لعروض الأسعار الملاحية والتعامل مع الخطوط الدولية")}</span>
              <CustomSelect
                value={form.watch('maritimeDefaultCurrency') || 'USD'}
                onChange={(val) => form.setValue('maritimeDefaultCurrency', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'USD', label: t('settings.forms.tabs.sales_inventory_settings_tab.s68', "الدولار الأمريكي (USD $)") },
                  { value: 'EUR', label: t('settings.forms.tabs.sales_inventory_settings_tab.s69', "اليورو الأوروبي (EUR €)") },
                  { value: 'EGP', label: t('settings.forms.tabs.sales_inventory_settings_tab.s70', "الجنيه المصري (EGP)") },
                  { value: 'SAR', label: t('settings.forms.tabs.sales_inventory_settings_tab.s71', "الريال السعودي (SAR)") },
                  { value: 'AED', label: t('settings.forms.tabs.sales_inventory_settings_tab.s72', "الدرهم الإماراتي (AED)") },
                ]}
                disabled={disabled}
              />
            </div>

            {/* Zero cost */}
            <label style={{ ...premiumCardStyle, gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <ZeroCostIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s73', "السماح بإصدار حركات تكلفة صفرية")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s74', "مخصص لنقل الحاويات الفارغة وإرجاع المعدات الملاحية دون تكلفة شراء مباشرة")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('allowZeroPurchaseCost')} disabled={disabled} />
            </label>
          </div>
        </FormSection>
    </>
  );
}

export function ImportVerticalSection({ form, disabled }: SalesInventoryVerticalsProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* ===== مخصص لشركات الاستيراد والتصدير (Import/Export Dedicated) ===== */}
        <FormSection
          title={t('settings.forms.tabs.sales_inventory_settings_tab.s75', "ضوابط الرسائل الجمركية وتكاليف الاستيراد (Landed Cost & Customs)")}
          description={t('settings.forms.tabs.sales_inventory_settings_tab.s76', "تحديد معيار توزيع مصاريف الشحن والتخليص الجمركي وضريبة الوارد على بنود وأصناف الرسالة الاستيرادية.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={iconBadgeStyle}>
                  <LandedCostIcon size={20} />
                </div>
                <div>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s77', "أساس توزيع تكلفة الاستيراد الإجمالية (Landed Cost)")}</strong>
                  <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s78', "المعيار المحاسبي لتوزيع مصاريف الشحن والجمارك على تكلفة الوحدة في المخزن")}</span>
                </div>
              </div>
              <CustomSelect
                value={form.watch('importLandedCostMethod') || 'by_value'}
                onChange={(val) => form.setValue('importLandedCostMethod', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'by_value', label: t('settings.forms.tabs.sales_inventory_settings_tab.s79', "حسب القيمة المالية لكل صنف (Value Proportional)") },
                  { value: 'by_weight', label: t('settings.forms.tabs.sales_inventory_settings_tab.s80', "حسب الوزن الإجمالي (Gross Weight - KG/Ton)") },
                  { value: 'by_volume', label: t('settings.forms.tabs.sales_inventory_settings_tab.s81', "حسب الحجم بالمتر المكعب (CBM)") },
                  { value: 'by_quantity', label: t('settings.forms.tabs.sales_inventory_settings_tab.s82', "حسب عدد القطع والوحدات (Quantity)") },
                ]}
                disabled={disabled}
              />
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s83', "الربط التلقائي للمصاريف البنكية والاعتمادات")}</strong>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s84', "إدراج عمولات فتح الاعتماد المستندي (LC) وفروق أسعار الصرف ضمن تكلفة الشحنة")}</span>
              <CustomSelect
                value={form.watch('importAutoLinkBankExpenses') || 'auto_link'}
                onChange={(val) => form.setValue('importAutoLinkBankExpenses', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'auto_link', label: t('settings.forms.tabs.sales_inventory_settings_tab.s85', "ربط تلقائي بالرسالة الجمركية المفتوحة") },
                  { value: 'manual', label: t('settings.forms.tabs.sales_inventory_settings_tab.s86', "ترحيل يدوي لحساب المصروفات التمويلية") },
                ]}
                disabled={disabled}
              />
            </div>

            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <ZeroCostIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s87', "السماح بعينات استيرادية مجانية")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s88', "إمكانية استلام عينات تجارية واردة بتكلفة شراء صفر")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('allowZeroPurchaseCost')} disabled={disabled} />
            </label>

            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                <div style={iconBadgeStyle}>
                  <LowStockIndicatorIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s89', "حد التنبيه لنقص المخزون")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s90', "إشعار ببدء إجراءات فتح رسالة استيرادية جديدة عند وصول الرصيد لهذا الحد")}</small>
                </div>
              </div>
              <input
                className="purchase-prototype-field-input"
                type="number"
                min="0"
                {...form.register('lowStockThreshold')}
                disabled={disabled}
                placeholder="5"
                style={{ width: '80px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
          </div>
        </FormSection>
    </>
  );
}

export function ServicesVerticalSection({ form, disabled }: SalesInventoryVerticalsProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* ===== مخصص للمكاتب والشركات الخدمية (Services Dedicated) ===== */}
        <FormSection
          title={t('settings.forms.tabs.sales_inventory_settings_tab.s91', "ضوابط العقود والخدمات المهنية والاستشارية")}
          description={t('settings.forms.tabs.sales_inventory_settings_tab.s92', "تحديد نمط فوترة عقود الخدمات وإدارة فترات الاشتراكات والدفعات التعاقدية.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s93', "نمط احتساب وإصدار فواتير الخدمات")}</strong>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s94', "الأساس المعتمد لفوترة الخدمات المهنية والاستشارية لعملاء الشركة")}</span>
              <CustomSelect
                value={form.watch('servicesBillingMethod') || 'deliverable'}
                onChange={(val) => form.setValue('servicesBillingMethod', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'deliverable', label: t('settings.forms.tabs.sales_inventory_settings_tab.s95', "حسب تسليم البنود والمراحل (Milestone / Deliverable)") },
                  { value: 'subscription', label: t('settings.forms.tabs.sales_inventory_settings_tab.s96', "اشتراكات شهرية متكررة (Retainer / Monthly)") },
                  { value: 'hourly', label: t('settings.forms.tabs.sales_inventory_settings_tab.s97', "حسب ساعات العمل المسجلة (Time & Material)") },
                ]}
                disabled={disabled}
              />
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s98', "فترة الإشعار لتجديد عقود الخدمات")}</strong>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s99', "أيام الإشعار التلقائي قبل انتهاء مدة العقد أو الاشتراك لطلب التجديد")}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  min="1"
                  max="365"
                  className="purchase-prototype-field-input"
                  {...form.register('servicesContractRenewalNoticeDays')}
                  disabled={disabled}
                  placeholder="30"
                  style={{ ...fieldControlStyle, width: '100px', textAlign: 'center', fontWeight: 800 }}
                />
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s100', "يوم قبل الانتهاء")}</span>
              </div>
            </div>
          </div>
        </FormSection>
    </>
  );
}

export function ManufacturingVerticalSection({ form, disabled }: SalesInventoryVerticalsProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* ===== مخصص للمصانع والإنتاج الصناعي (Manufacturing Dedicated) ===== */}
        <FormSection
          title={t('settings.forms.tabs.sales_inventory_settings_tab.s101', "ضوابط التصنيع والإنتاج ومخازن المواد الخام")}
          description={t('settings.forms.tabs.sales_inventory_settings_tab.s102', "تحديد ضوابط حركة المواد الخام ومكونات الإنتاج وأوامر التشغيل بالمصنع.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
            {/* Card 1: Default Issue Mode for Materials */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s103', "نمط صرف خامات ومكونات الإنتاج الافتراضي")}</strong>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s104', "آلية خصم الخامات من المخازن عند إصدار إذن تشغيل الإنتاج")}</span>
              <CustomSelect
                value={form.watch('defaultBranchIssueMode') || 'final_issue'}
                onChange={(val) => form.setValue('defaultBranchIssueMode', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'final_issue', label: t('settings.forms.tabs.sales_inventory_settings_tab.s105', "صرف نهائي لأمر التشغيل (يُخصم الرصيد فوراً)") },
                  { value: 'transfer_to_branch_stock', label: t('settings.forms.tabs.sales_inventory_settings_tab.s106', "تحويل لمستودع تشغيل / خط الإنتاج (قيد الاستخدام)") },
                ]}
                disabled={disabled}
              />
            </div>

            {/* Card 2: Raw Materials Low Stock Threshold */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s107', "حد التنبيه لنقص المواد الخام والمكونات")}</strong>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s108', "إظهار تنبيه نقص المواد الخام في لوحة التحكم عند وصول الرصيد لهذا الحد")}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  min="0"
                  className="purchase-prototype-field-input"
                  {...form.register('lowStockThreshold')}
                  disabled={disabled}
                  placeholder="10"
                  style={{ ...fieldControlStyle, width: '100px', textAlign: 'center', fontWeight: 800 }}
                />
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s109', "وحدة مخزنية")}</span>
              </div>
            </div>

            {/* Card 3: Allow Zero Purchase Cost */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <ZeroCostIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s110', "السماح بسعر شراء صفر لخامات وعينات التشغيل")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s111', "مخصص لخامات التشغيل المهداة، العينات المخبرية، ومخلفات التدوير")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('allowZeroPurchaseCost')} disabled={disabled} />
            </label>

            {/* Card 4: Allow Negative Stock Sales */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <NegativeStockIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s112', "السماح بصرف الخامات بالسالب")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s113', "تخطي رصيد المخزن لتفادي توقف خطوط الإنتاج قبل وصول أذون الإضافة")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('allowNegativeStockSales')} disabled={disabled} />
            </label>
          </div>
        </FormSection>
    </>
  );
}
