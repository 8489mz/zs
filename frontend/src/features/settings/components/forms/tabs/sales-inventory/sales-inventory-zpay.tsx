// Z-Pay section (Section 10) — pure move from SalesInventorySettingsTab.tsx (slice S5).
// The facade keeps the gate wrapper ({showPosSettings && (...)}) and passes form, disabled, settings and showPosSettings as props.
// settings + showPosSettings are carried in the props interface for uniformity; the moved text never reads them as code identifiers (S0/S3 precedent).
// PREP CORRECTION (S0 agent, grep-proven): prep §3 lists "Link" as an S5 dep — S5 never uses the Link component; the only "Link" hit is a string literal, so no Link import here.

import { useTranslation } from 'react-i18next';
import { FormSection } from '@/shared/components/form-section';
import { premiumCheckboxInputStyle } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-shared';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';

export interface SalesInventoryZpayProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  settings?: AppSettings;
  showPosSettings: boolean;
}

export function SalesInventoryZpay({ form, disabled }: SalesInventoryZpayProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* ===== منظومة المدفوعات والـ QR الذكي (Z-Pay Smart Payment Hub) ===== */}
        <FormSection
          title={t('settings.forms.tabs.sales_inventory_settings_tab.s174', "منظومة المدفوعات والـ QR الذكي (Z-Pay Smart Payment Hub)")}
          description={t('settings.forms.tabs.sales_inventory_settings_tab.s175', "إعدادات استقبال المدفوعات الفورية عبر إنستاباي (InstaPay Dynamic QR) والمحافظ الإلكترونية (فودافون كاش وميزة) وروابط البطاقات مباشرة على ماكينات Sunmi وشاشات الكاشير.")}
        >
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '4px' }}>
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s176', "عنوان أو رقم إنستاباي للمحل (InstaPay IPA / Phone)")}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  {...form.register('instapayAddress')}
                  disabled={disabled}
                  placeholder={t('settings.forms.tabs.sales_inventory_settings_tab.s177', "01018017523 أو username@instapay")}
                  style={{
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    padding: '0 12px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    width: '100%',
                    boxSizing: 'border-box',
                    textAlign: 'left',
                  }}
                />
                <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s178', "الرقم أو الحساب الذي يستقبل تحويلات إنستاباي اللحظية عند اختيار دفع InstaPay في الكاشير.")}
                </small>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '4px' }}>
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s179', "رقم المحفظة الإلكترونية (Mobile Wallet Number)")}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  {...form.register('walletNumber')}
                  disabled={disabled}
                  placeholder="01018017523"
                  style={{
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    padding: '0 12px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    width: '100%',
                    boxSizing: 'border-box',
                    textAlign: 'left',
                  }}
                />
                <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s180', "رقم المحفظة (فودافون كاش، أورنج، اتصالات، وي، سمارت والت) لاستقبال تحويلات المحافظ.")}
                </small>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '4px' }}>
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s181', "اسم مزود خدمة المحفظة الافتراضي")}
                </label>
                <input
                  type="text"
                  {...form.register('walletProviderName')}
                  disabled={disabled}
                  placeholder={t('settings.forms.tabs.sales_inventory_settings_tab.s182', "فودافون كاش")}
                  style={{
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    padding: '0 12px',
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                />
                <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s183', "الاسم التوضيحي الذي يظهر للكاشير والعميل (مثال: فودافون كاش، محفظة البنك الأهلي).")}
                </small>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '4px' }}>
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s184', "رابط بوابة الدفع الإلكتروني للبطاقات (Payment Link URL - اختياري)")}
                </label>
                <input
                  type="url"
                  dir="ltr"
                  {...form.register('paymentLinkBaseUrl')}
                  disabled={disabled}
                  placeholder="https://accept.paymob.com/..."
                  style={{
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    padding: '0 12px',
                    fontSize: '0.82rem',
                    width: '100%',
                    boxSizing: 'border-box',
                    textAlign: 'left',
                  }}
                />
                <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s185', "لتوليد كود مسح ودفع بالفيزا والماستركارد وأبل باي أونلاين للعملاء عبر هواتفهم.")}
                </small>
              </div>
            </div>

            {/* Checkboxes Row */}
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: disabled ? 'not-allowed' : 'pointer' }}>
                <input
                  type="checkbox"
                  style={premiumCheckboxInputStyle}
                  {...form.register('enableDynamicPaymentQr')}
                  disabled={disabled}
                />
                <div>
                  <strong style={{ fontSize: '0.82rem', color: '#0f172a', fontWeight: 700, display: 'block' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s186', "تفعيل عرض كود الـ QR الديناميكي للدفع فورياً على شاشة ماكينة Sunmi ونقاط البيع")}
                  </strong>
                  <small style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s187', "عرض رمز الـ QR بالمبلغ الصافي ورقم المحفظة فورياً للكاشير والعميل لمسحه بالهاتف.")}
                  </small>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: disabled ? 'not-allowed' : 'pointer' }}>
                <input
                  type="checkbox"
                  style={premiumCheckboxInputStyle}
                  {...form.register('printPaymentQrOnReceipt')}
                  disabled={disabled}
                />
                <div>
                  <strong style={{ fontSize: '0.82rem', color: '#0f172a', fontWeight: 700, display: 'block' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s188', "طباعة رمز الـ QR تلقائياً على بون الفاتورة الحرارية (اختياري)")}
                  </strong>
                  <small style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s189', "إدراج كود الدفع السريع أسفل الفاتورة لتمكين العميل من مسح البون المطبوع والدفع لاحقاً.")}
                  </small>
                </div>
              </label>

              {/* Tax E-Receipt Toggle (Strictly Optional & Disabled by default) */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px', marginTop: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <strong style={{ fontSize: '0.82rem', color: '#334155', fontWeight: 700, display: 'block' }}>
                      {t('settings.forms.tabs.sales_inventory_settings_tab.s190', "منظومة الإيصال الإلكتروني لمصلحة الضرائب المصرية (ETA E-Receipt)")}
                    </strong>
                    <small style={{ fontSize: '0.74rem', color: '#64748b' }}>
                      {t('settings.forms.tabs.sales_inventory_settings_tab.s191', "خيار اختياري تماماً للمنشآت الملزمة فقط. يبقى معطلاً للمحلات والأنشطة العادية دون أي قيود ضريبية.")}
                    </small>
                  </div>
                  <select
                    {...form.register('taxComplianceMode')}
                    disabled={disabled}
                    style={{
                      height: '34px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      padding: '0 10px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      background: '#ffffff',
                      color: '#0f172a',
                    }}
                  >
                    <option value="disabled">{t('settings.forms.tabs.sales_inventory_settings_tab.s192', "معطل (الافتراضي - بدون أي ربط ضريبي)")}</option>
                    <option value="optional_eta">{t('settings.forms.tabs.sales_inventory_settings_tab.s193', "تفعيل تجريبي اختياري لمنظومة مصلحة الضرائب")}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </FormSection>
    </>
  );
}
