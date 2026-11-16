// Loyalty section (Section 12) — pure move from SalesInventorySettingsTab.tsx (slice S8).
// The facade keeps the showPosSettings gate + render and passes form, disabled, settings and the hook values as props;
// the facade calls useSalesInventoryLoyalty({ form }) once and passes its returns as props.

import { useTranslation } from 'react-i18next';
import { FormSection } from '@/shared/components/form-section';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { LightbulbIcon } from '@/shared/components/icons/AppIcons';
import { TaxCalcIcon, ZeroCostIcon, IssueModeDocIcon, premiumCardStyle, iconBadgeStyle, premiumCardTextStyle, premiumCheckboxInputStyle } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-shared';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';

function LoyaltyPointsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export function useSalesInventoryLoyalty({ form }: { form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput> }) {
  // INV-FE3-FRONTEND-BOOK-DIGITS: the live loyalty preview (points ×
  // redeem value) is money; it rounds at the tenant's book digits, not
  // hardcoded 2dp. (The redeem rate % rendered with it is a percent and
  // keeps 1dp.)
  const loyaltyBookDigits = currencyMoneyDigits(getGlobalSystemCurrency());
  const loyaltyPreviewPoints = Math.floor((1000 / 100) * Number(form.watch('loyaltyPointsPer100Egp') || 10));
  const loyaltyPreviewValue = roundMoneyValue(loyaltyPreviewPoints * Number(form.watch('loyaltyPointRedeemValue') || 0.1), loyaltyBookDigits);
  return { loyaltyBookDigits, loyaltyPreviewPoints, loyaltyPreviewValue };
}

export interface SalesInventoryLoyaltyProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  settings?: AppSettings;
  showPosSettings: boolean;
  loyaltyBookDigits: number;
  loyaltyPreviewPoints: number;
  loyaltyPreviewValue: number;
}

export function SalesInventoryLoyalty({ form, disabled, loyaltyBookDigits, loyaltyPreviewPoints, loyaltyPreviewValue }: SalesInventoryLoyaltyProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* ===== برنامج نقاط وولاء العملاء ===== */}
        <FormSection
          title={t('settings.forms.tabs.sales_inventory_settings_tab.s212', "برنامج نقاط ومكافآت ولاء العملاء (Customer Loyalty Program)")}
          description={t('settings.forms.tabs.sales_inventory_settings_tab.s213', "تحفيز العملاء على الشراء المتكرر عبر منحهم نقاطاً مع كل فاتورة، وإمكانية استبدالها برصيد وخصم فوري في الفواتير التالية.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
            {/* 1. Toggle Loyalty */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <LoyaltyPointsIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s214', "تفعيل برنامج نقاط الولاء")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s215', "احتساب نقاط تلقائياً للعميل عند البيع وإتاحة استبدالها في الكاشير")}</small>
                </div>
              </div>
              <input
                type="checkbox"
                style={premiumCheckboxInputStyle}
                {...form.register('loyaltyEnabled')}
                disabled={disabled}
              />
            </label>

            {/* 2. Print on Receipt */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <IssueModeDocIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s216', "إظهار رصيد النقاط في الفاتورة")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s217', "طباعة النقاط المكتسبة والرصيد الإجمالي في الإيصالات الحرارية وفواتير A4")}</small>
                </div>
              </div>
              <input
                type="checkbox"
                style={premiumCheckboxInputStyle}
                {...form.register('printShowLoyaltyPoints')}
                disabled={disabled}
              />
            </label>

            {/* 3. Earning Rate */}
            <div style={{ ...premiumCardStyle, cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <LoyaltyPointsIcon size={20} />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s218', "معدل اكتساب النقاط")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s219', "عدد النقاط المكتسبة لكل 100 جنيه مشتريات مسددة:")}</small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    className="purchase-prototype-field-input"
                    type="number"
                    min="0"
                    step="1"
                    {...form.register('loyaltyPointsPer100Egp')}
                    disabled={disabled || !form.watch('loyaltyEnabled')}
                    placeholder="10"
                    style={{ width: '75px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1.5px solid #cbd5e1' }}
                  />
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s220', "نقطة")}</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '4px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                {[
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s221', "5 نقاط"), val: 5 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s222', "10 نقاط"), val: 10 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s223', "20 نقطة"), val: 20 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s224', "50 نقطة"), val: 50 },
                ].map((p) => {
                  const currentVal = Number(form.watch('loyaltyPointsPer100Egp') ?? 10);
                  const isSelected = currentVal === p.val;
                  return (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => form.setValue('loyaltyPointsPer100Egp', p.val, { shouldDirty: true, shouldValidate: true })}
                      disabled={disabled || !form.watch('loyaltyEnabled')}
                      style={{
                        padding: '4px 2px',
                        fontSize: '0.71rem',
                        textAlign: 'center',
                        borderRadius: '6px',
                        border: isSelected ? '1px solid #170e5e' : '1px solid #e2e8f0',
                        background: isSelected ? '#eef2ff' : '#f8fafc',
                        color: isSelected ? '#170e5e' : '#475569',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Redemption Value */}
            <div style={{ ...premiumCardStyle, cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <ZeroCostIcon size={20} />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s225', "قيمة النقطة عند الاستبدال")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s226', "القيمة المالية للنقطة الواحدة كخصم بالجنيه:")}</small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    className="purchase-prototype-field-input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    {...form.register('loyaltyPointRedeemValue')}
                    disabled={disabled || !form.watch('loyaltyEnabled')}
                    placeholder="0.10"
                    style={{ width: '85px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1.5px solid #cbd5e1' }}
                  />
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}><CurrencySymbol /></span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '4px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                {[
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s227', "0.05 ج (5 قروش)"), val: 0.05 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s228', "0.10 ج (10 قروش)"), val: 0.1 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s229', "0.50 ج (نصف جنيه)"), val: 0.5 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s230', "1.00 ج (جنيه كامل)"), val: 1 },
                ].map((p) => {
                  const currentVal = Number(form.watch('loyaltyPointRedeemValue') ?? 0.1);
                  const isSelected = Math.abs(currentVal - p.val) < 0.001;
                  return (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => form.setValue('loyaltyPointRedeemValue', p.val, { shouldDirty: true, shouldValidate: true })}
                      disabled={disabled || !form.watch('loyaltyEnabled')}
                      style={{
                        padding: '4px 2px',
                        fontSize: '0.71rem',
                        textAlign: 'center',
                        borderRadius: '6px',
                        border: isSelected ? '1px solid #170e5e' : '1px solid #e2e8f0',
                        background: isSelected ? '#eef2ff' : '#f8fafc',
                        color: isSelected ? '#170e5e' : '#475569',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 5. Minimum Redeem Points */}
            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <LoyaltyPointsIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s231', "الحد الأدنى للنقاط للاستبدال")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s232', "أقل رصيد نقاط يجب أن يمتلكه العميل ليتمكن من الخصم")}</small>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  className="purchase-prototype-field-input"
                  type="number"
                  min="0"
                  step="1"
                  {...form.register('loyaltyMinRedeemPoints')}
                  disabled={disabled || !form.watch('loyaltyEnabled')}
                  placeholder="50"
                  style={{ width: '75px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1.5px solid #cbd5e1' }}
                />
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s233', "نقطة")}</span>
              </div>
            </div>

            {/* 6. Max Discount Percentage */}
            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <TaxCalcIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s234', "سقف الخصم بالنقاط من الفاتورة")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s235', "أقصى نسبة مئوية مسموح بخصمها من إجمالي الفاتورة عبر النقاط")}</small>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  className="purchase-prototype-field-input"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  {...form.register('loyaltyMaxDiscountPercentage')}
                  disabled={disabled || !form.watch('loyaltyEnabled')}
                  placeholder="50"
                  style={{ width: '75px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1.5px solid #cbd5e1' }}
                />
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>%</span>
              </div>
            </div>
          </div>

          {/* Live Simulation Card */}
          {form.watch('loyaltyEnabled') ? (
            <div style={{
              marginTop: '12px',
              padding: '12px 16px',
              borderRadius: '10px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <LightbulbIcon size={18} color="#170e5e" />
                <span style={{ fontSize: '0.84rem', color: '#1e293b', fontWeight: 700 }}>
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s236', "معاينة حية للمحرك: مشتريات بقيمة")} <strong>1,000 <CurrencySymbol /></strong> {t('settings.forms.tabs.sales_inventory_settings_tab.s237', "تمنح العميل")}{' '}
                  <strong style={{ color: '#170e5e' }}>
                    {loyaltyPreviewPoints} {t('settings.forms.tabs.sales_inventory_settings_tab.s238', "نقطة")}
                  </strong>{' '}
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s239', "قيمتها")}{' '}
                  <strong style={{ color: '#170e5e' }}>
                    {loyaltyPreviewValue.toFixed(loyaltyBookDigits)} <CurrencySymbol />
                  </strong>{' '}
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s240', "خصم فوري في مشترياته القادمة (معدل استرجاع")}{' '}
                  <strong>
                    {(((Math.floor((1000 / 100) * Number(form.watch('loyaltyPointsPer100Egp') || 10)) * Number(form.watch('loyaltyPointRedeemValue') || 0.1)) / 1000) * 100).toFixed(1)}%
                  </strong>).
                </span>
              </div>
            </div>
          ) : null}
        </FormSection>
    </>
  );
}
