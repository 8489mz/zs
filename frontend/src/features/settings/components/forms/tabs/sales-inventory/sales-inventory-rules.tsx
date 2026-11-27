// Rules section (Section 7) — pure move from SalesInventorySettingsTab.tsx (slice S2).
// The facade keeps the isRetailCommerce gate + render and passes form, disabled, settings and flags as props;
// the facade calls useSalesInventoryRulesState() once and passes its returns as props.

import {useState, type Dispatch, type SetStateAction} from 'react';
import { useTranslation } from 'react-i18next';
import { FormSection } from '@/shared/components/form-section';
import { CustomSelect } from '@/shared/ui/custom-select';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { CheckShieldIcon, LockIcon, ClockIcon, EyeOffIcon } from '@/shared/components/icons/AppIcons';
import { NegativeStockIcon, ZeroCostIcon, LowStockIndicatorIcon, IssueModeDocIcon, premiumCardStyle, iconBadgeStyle, premiumCardTextStyle, premiumCheckboxInputStyle, fieldControlStyle } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-shared';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';

function CashierShiftLockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <circle cx="12" cy="16" r="1" />
    </svg>
  );
}

function DeliveryModeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
      <path d="M5 17H3v-4l2-5h9v9" />
      <path d="m14 7 3 3h4v4h-2" />
      <path d="M9 17h6" />
    </svg>
  );
}

function RestaurantTablesIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16" />
      <path d="M4 10h16" />
      <path d="M6 10v10" />
      <path d="M18 10v10" />
      <path d="M10 10v6" />
      <path d="M14 10v6" />
    </svg>
  );
}

function RestaurantServiceChargeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
      <path d="M16 11l2 2 4-4" />
    </svg>
  );
}

function CourierCommissionIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}

function DefaultDeliveryFeeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

export function useSalesInventoryRulesState() {
  const [isChangingPin, setIsChangingPin] = useState(false);
  return { isChangingPin, setIsChangingPin };
}

export interface SalesInventoryRulesProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  settings?: AppSettings;
  isRestaurantVertical: boolean;
  showPosSettings: boolean;
  showPhysicalInventory: boolean;
  isStoreFleet: boolean;
  isChangingPin: boolean;
  setIsChangingPin: Dispatch<SetStateAction<boolean>>;
}

export function SalesInventoryRules({ form, disabled, settings, isRestaurantVertical, showPosSettings, showPhysicalInventory, isStoreFleet, isChangingPin, setIsChangingPin }: SalesInventoryRulesProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* ===== خيارات وقواعد البيع والمخزون (للتجارة والتجزئة والأنشطة العامة) ===== */}
        <FormSection
          title={t('settings.forms.tabs.sales_inventory_settings_tab.s114', "خيارات وقواعد البيع والمخزون")}
          description={t('settings.forms.tabs.sales_inventory_settings_tab.s115', "ضوابط حركة المخازن والأرصدة وعمليات الكاشير وإصدار أذونات الصرف.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
          {/* Card 1: Negative Stock */}
          {showPhysicalInventory && (
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <NegativeStockIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s116', "السماح بالبيع بالسالب")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s117', "تخطي تحذير عدم كفاية المخزون عند إتمام الفاتورة بالكاشير")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('allowNegativeStockSales')} disabled={disabled} />
            </label>
          )}

          {/* Card: Hide Out of Stock Items */}
          {showPhysicalInventory && (
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <EyeOffIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.pos_hide_out_of_stock', "إخفاء الأصناف النافذة بالكاشير")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.pos_hide_out_of_stock_desc', "إخفاء المنتجات المنتهية من المخزون تلقائياً من شبكة الكاشير عند حظر البيع بالسالب")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posHideOutOfStockItems')} disabled={disabled} />
            </label>
          )}

          {/* Card 2: Zero Purchase Cost */}
          <label style={premiumCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={iconBadgeStyle}>
                <ZeroCostIcon size={20} />
              </div>
              <div style={premiumCardTextStyle}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s118', "السماح بسعر شراء صفر")}</strong>
                <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s119', "مخصص للأصناف المهداة، العينات المجانية، والعطايا الترويجية")}</small>
              </div>
            </div>
            <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('allowZeroPurchaseCost')} disabled={disabled} />
          </label>

          {/* Card 3: Require Shift (Only for POS) */}
          {showPosSettings && (
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <CashierShiftLockIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s120', "إجبار فتح وردية لعمليات الكاشير")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s121', "منع البيع قبل فتح الوردية وتحديد العهدة لضبط الخزينة")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('requireCashierShiftForSales')} disabled={disabled} />
            </label>
          )}

          {/* Card 3b: Require Password On Shift Open (Only for POS) */}
          {showPosSettings && (
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <LockIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s120_pwd', "طلب كلمة المرور عند فتح الوردية")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s121_pwd', "التحقق من هوية الكاشير بكلمة المرور قبل بدء الوردية وفتح الصندوق")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('requirePasswordOnShiftOpen')} disabled={disabled} />
            </label>
          )}

          {/* Card 4: Low Stock Alert */}
          {showPhysicalInventory && (
            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <LowStockIndicatorIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s122', "حد التنبيه لنقص المخزون")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s123', "يظهر تنبيه نواقص عندما يصل الرصيد لهذا الحد أو أقل")}</small>
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
          )}

          {/* Card 4.5: Max Cashier Discount Approval Threshold & Manager PIN (Only for POS) */}
          {showPosSettings && (
            <div style={{ gridColumn: '1 / -1', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={iconBadgeStyle}>
                    <CashierShiftLockIcon size={20} />
                  </div>
                  <div>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s124', "سقف خصم الكاشير واعتماد المدير (PIN)")}</strong>
                    <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s125', "اشتراط إدخال PIN المدير عند إعطاء الكاشير خصماً يتجاوز حداً معيناً أو لتعديل العمليات الحساسة")}</span>
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: form.watch('posMaxDiscountThresholdEnabled') ? '#166534' : '#64748b' }}>
                    {form.watch('posMaxDiscountThresholdEnabled') ? t('settings.forms.tabs.sales_inventory_settings_tab.s126', "سقف الخصم: مفعّل") : t('settings.forms.tabs.sales_inventory_settings_tab.s127', "سقف الخصم: معطل")}
                  </span>
                  <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posMaxDiscountThresholdEnabled')} disabled={disabled} />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s128', "الرمز السري للمدير (PIN)")}
                  </label>
                  {settings?.hasManagerPin && !isChangingPin ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', minHeight: '38px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#166534' }}>
                          {t('settings.forms.tabs.sales_inventory_settings_tab.s129', "تم حفظ وتفعيل رمز سري للمدير")}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsChangingPin(true);
                          form.setValue('managerPin', '', { shouldDirty: true });
                        }}
                        disabled={disabled}
                        style={{
                          padding: '3px 10px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          color: '#170c5c',
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: '5px',
                          cursor: 'pointer',
                        }}
                      >
                        {t('settings.forms.tabs.sales_inventory_settings_tab.s130', "تغيير الرمز")}
                      </button>
                    </div>
                  ) : !settings?.hasManagerPin && !isChangingPin ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', minHeight: '38px' }}>
                      <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {t('settings.forms.tabs.sales_inventory_settings_tab.s131', "لم يتم تعيين رمز سري بعد (اختياري)")}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsChangingPin(true);
                          form.setValue('managerPin', '', { shouldDirty: true });
                        }}
                        disabled={disabled}
                        style={{
                          padding: '3px 10px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          color: '#170c5c',
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: '5px',
                          cursor: 'pointer',
                        }}
                      >
                        {t('settings.forms.tabs.sales_inventory_settings_tab.s132', "تعيين رمز PIN")}
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="password"
                          inputMode="numeric"
                          autoComplete="new-password"
                          data-lpignore="true"
                          data-1p-ignore="true"
                          maxLength={10}
                          className="purchase-prototype-field-input"
                          {...form.register('managerPin')}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                            form.setValue('managerPin', digits, { shouldValidate: true, shouldDirty: true });
                          }}
                          disabled={disabled}
                          placeholder={t('settings.forms.tabs.sales_inventory_settings_tab.s133', "أدخل الرمز الجديد (4 - 10 أرقام)")}
                          style={fieldControlStyle}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setIsChangingPin(false);
                            form.setValue('managerPin', '', { shouldDirty: false });
                            form.clearErrors('managerPin');
                          }}
                          style={{
                            padding: '7px 12px',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            color: '#64748b',
                            background: '#f1f5f9',
                            border: '1px solid #e2e8f0',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {t('settings.forms.tabs.sales_inventory_settings_tab.s134', "إلغاء")}
                        </button>
                      </div>
                      <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                        {t('settings.forms.tabs.sales_inventory_settings_tab.s135', "الرمز السري المطلوب لاعتماد العمليات الحساسة وتجاوز سقف الخصم بالكاشير.")}
                      </small>
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s142', "الخصم الصغير المسموح لأي كاشير بدون اعتماد")} {`(${getGlobalCurrencySymbol()})`}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className="purchase-prototype-field-input"
                    {...form.register('posSmallDiscountFlatAllowance')}
                    disabled={disabled}
                    placeholder={t('settings.forms.tabs.sales_inventory_settings_tab.s143', "مثال: 2")}
                    style={fieldControlStyle}
                  />
                  <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s144', "أي كاشير، حتى بدون صلاحية خصم، يقدر يخصم لحد المبلغ ده من غير رمز مدير (تقريب الفكة، مثال: 232 تبقى 230).")}
                  </small>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s145', "حد المرتجع النقدي الكبير الذي يتطلب اعتماد المدير")} {`(${getGlobalCurrencySymbol()})`}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className="purchase-prototype-field-input"
                    {...form.register('posLargeCashRefundThreshold')}
                    disabled={disabled}
                    placeholder={t('settings.forms.tabs.sales_inventory_settings_tab.s146', "مثال: 500")}
                    style={fieldControlStyle}
                  />
                  <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s147', "المرتجع النقدي الأصغر من المبلغ ده يتم من غير رمز مدير؛ الأكبر أو المساوي له يتطلب رمز اعتماد المدير أو كلمة مرور المدير.")}
                  </small>
                </div>

                {form.watch('posMaxDiscountThresholdEnabled') && (
                  <>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                        {t('settings.forms.tabs.sales_inventory_settings_tab.s136', "طريقة حساب سقف الخصم")}
                      </label>
                      <CustomSelect
                        value={form.watch('posMaxDiscountThresholdType') || 'percentage'}
                        onChange={(val) => form.setValue('posMaxDiscountThresholdType', val as any, { shouldDirty: true, shouldValidate: true })}
                        options={[
                          { value: 'percentage', label: t('settings.forms.tabs.sales_inventory_settings_tab.s137', "نسبة مئوية من إجمالي الفاتورة (%)") },
                          { value: 'fixed', label: `مبلغ ثابت بالعملة (${getGlobalCurrencySymbol()})` },
                        ]}
                        disabled={disabled}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                        {t('settings.forms.tabs.sales_inventory_settings_tab.s138', "قيمة سقف الخصم المسموح به")} {form.watch('posMaxDiscountThresholdType') === 'fixed' ? `(${getGlobalCurrencySymbol()})` : '(%)'}
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        className="purchase-prototype-field-input"
                        {...form.register('posMaxDiscountThresholdValue')}
                        disabled={disabled}
                        placeholder={form.watch('posMaxDiscountThresholdType') === 'fixed' ? t('settings.forms.tabs.sales_inventory_settings_tab.s139', "مثال: 50") : t('settings.forms.tabs.sales_inventory_settings_tab.s140', "مثال: 15")}
                        style={fieldControlStyle}
                      />
                      <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                        {t('settings.forms.tabs.sales_inventory_settings_tab.s141', "عند تطبيق خصم أعلى من هذا الحد بالكاشير، لن تكتمل الفاتورة إلا بإدخال رمز مرور المدير (PIN).")}
                      </small>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Card 5: Default Branch Issue Mode (Span 2) */}
          {showPhysicalInventory && (
            <div style={{ gridColumn: '1 / -1', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={iconBadgeStyle}>
                  <IssueModeDocIcon size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s142', "وضع إذن الصرف الافتراضي")}</strong>
                    <div style={{ minWidth: '280px' }}>
                      <CustomSelect
                        value={form.watch('defaultBranchIssueMode') || 'final_issue'}
                        onChange={(val) => form.setValue('defaultBranchIssueMode', val as any, { shouldDirty: true, shouldValidate: true })}
                        options={[
                          { value: 'final_issue', label: t('settings.forms.tabs.sales_inventory_settings_tab.s143', "صرف نهائي (يتم خصم الرصيد فوراً)") },
                          { value: 'transfer_to_branch_stock', label: t('settings.forms.tabs.sales_inventory_settings_tab.s144', "تحويل إلى رصيد فرع (يبقى بانتظار الاستلام)") },
                        ]}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                  <span style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s145', "استخدم")} <strong>{t('settings.forms.tabs.sales_inventory_settings_tab.s146', "الصرف النهائي")}</strong> {t('settings.forms.tabs.sales_inventory_settings_tab.s147', "إذا كان الفرع لا يدار مخزونه على النظام، أو")} <strong>{t('settings.forms.tabs.sales_inventory_settings_tab.s148', "تحويل إلى رصيد فرع")}</strong> {t('settings.forms.tabs.sales_inventory_settings_tab.s149', "إذا كان الفرع يبيع من رصيده على النظام.")}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Delivery Handling Cards (Only for POS / Retail / Fleets) */}
          {showPosSettings && (
            <>
              {/* Card 6: Delivery Fee Mode */}
              <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <DeliveryModeIcon size={20} />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s150', "معالجة رسوم التوصيل")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                      {isStoreFleet ? t('settings.forms.tabs.sales_inventory_settings_tab.s151', "أسطول المتجر (إيراد للمحل وتُطبق عمولة الطيار)") : t('settings.forms.tabs.sales_inventory_settings_tab.s152', "مناديب حرة / طياري (100% للمندوب ولا تدخل الخزينة)")}
                    </small>
                  </div>
                </div>
                <div style={{ width: isStoreFleet ? '170px' : '200px' }}>
                  <CustomSelect
                    value={form.watch('deliveryFeeMode') || 'freelance_courier'}
                    onChange={(val) => form.setValue('deliveryFeeMode', val as any, { shouldDirty: true, shouldValidate: true })}
                    options={[
                      { value: 'freelance_courier', label: t('settings.forms.tabs.sales_inventory_settings_tab.s153', "مناديب حرة (طياري)") },
                      { value: 'store_fleet', label: t('settings.forms.tabs.sales_inventory_settings_tab.s154', "أسطول المتجر (داخلي)") },
                    ]}
                    disabled={disabled}
                  />
                </div>
              </div>

              {/* Card 7: Default Delivery Fee */}
              <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <DefaultDeliveryFeeIcon size={20} />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s155', "رسوم التوصيل الافتراضية")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                      {t('settings.forms.tabs.sales_inventory_settings_tab.s156', "تُملأ تلقائياً عند اختيار دليفري وقابلة للتعديل بالكاشير")}
                    </small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    className="purchase-prototype-field-input"
                    type="number"
                    min="0"
                    step="1"
                    {...form.register('defaultDeliveryFee')}
                    disabled={disabled}
                    placeholder="0"
                    style={{ width: '85px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#64748b' }}><CurrencySymbol /></span>
                </div>
              </div>

              {/* Card 8: Store Fleet Courier Commission Rate (Only visible when store fleet is active) */}
              {isStoreFleet && (
                <div style={{ ...premiumCardStyle, cursor: 'default', gridColumn: '1 / -1' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                    <div style={iconBadgeStyle}>
                      <CourierCommissionIcon size={20} />
                    </div>
                    <div style={premiumCardTextStyle}>
                      <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s157', "نسبة الطيار من التوصيل")}</strong>
                      <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s158', "عمولة طياري الأسطول (0% للثابت)")}</small>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      className="purchase-prototype-field-input"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      {...form.register('storeFleetCommissionRate')}
                      disabled={disabled}
                      placeholder="0"
                      style={{ width: '70px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                    />
                    <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#334155' }}>%</span>
                  </div>
                </div>
              )}

              {/* Card 8.5: Van Sales Settlement Supervisor PIN Requirement */}
              <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <CheckShieldIcon size={20} color="#170e5e" />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s159', "إلزامية رمز المشرف (PIN) لتصفية رحلات المناديب")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                      {form.watch('vanSettlementRequireSupervisorPin')
                        ? t('settings.forms.tabs.sales_inventory_settings_tab.s160', "مفعل: يلزم إدخال رمز المشرف (PIN) على هاتف المندوب لإتمام التصفية وإبراء العهدة")
                        : t('settings.forms.tabs.sales_inventory_settings_tab.s161', "معطل: يقفل المندوب ورديته مباشرة وتعتمد التصفية ويستلم الكاش من لوحة الإدارة")}
                    </small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    id="vanSettlementRequireSupervisorPin"
                    {...form.register('vanSettlementRequireSupervisorPin')}
                    disabled={disabled}
                    style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#170e5e' }}
                  />
                </div>
              </div>

              {/* Card 8.6: Van Sales Blind Settlement (الجرد والتوريد العمياني) */}
              <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <LockIcon size={20} color="#170e5e" />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s162', "إلزام التوريد العمياني لكاش المناديب (Blind Settlement)")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                      {form.watch('vanSettlementBlindMode')
                        ? t('settings.forms.tabs.sales_inventory_settings_tab.s163', "مفعل: إخفاء صافي النقدية المتوقعة وزر المطابقة؛ يُجبر المندوب على عد الكاش الفعلي واحتساب الفروقات رقابياً")
                        : t('settings.forms.tabs.sales_inventory_settings_tab.s164', "معطل: يظهر صافي النقدية المتوقعة وزر المطابقة أمام المندوب بشفافية لتسريع التصفية")}
                    </small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    id="vanSettlementBlindMode"
                    {...form.register('vanSettlementBlindMode')}
                    disabled={disabled}
                    style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#170e5e' }}
                  />
                </div>
              </div>

              {/* Card 8.7: Van Rep Discount Cap (INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING) */}
              <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <CheckShieldIcon size={20} color="#170e5e" />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s167', "سقف خصم المناديب %")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                      {t('settings.forms.tabs.sales_inventory_settings_tab.s168', "الحد الأقصى للخصم الإجمالي (خصم السطور + خصم الفاتورة) الذي يمنحه أي مندوب بدون رمز المشرف. الافتراضي 5%. صفر يعني منع الخصم تماماً.")}
                    </small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="number"
                    id="vanRepDiscountCapPercent"
                    min={0}
                    max={100}
                    {...form.register('vanRepDiscountCapPercent', { valueAsNumber: true })}
                    disabled={disabled}
                    style={{ width: '64px', height: '30px', padding: '0 6px', fontSize: '0.85rem', fontWeight: 800, textAlign: 'center', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                  />
                  <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#170e5e' }}>%</span>
                </div>
              </div>

              {/* Card 8.8: Cash Discount % (INV-VAN-PRICE-LIST-WIRING) */}
              <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <CheckShieldIcon size={20} color="#170e5e" />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s174', "خصم الدفع النقدي %")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                      {t('settings.forms.tabs.sales_inventory_settings_tab.s175', "خصم النظام على الدفع النقدي الفوري فقط (لا يسري على الآجل أو البطاقة أو المقسّط). يُحسب من سعر البيع بعد خصم المندوب، ولا يحتاج رمز مشرف. صفر يعني إيقافه.")}
                    </small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="number"
                    id="cashDiscountPercent"
                    min={0}
                    max={100}
                    {...form.register('cashDiscountPercent', { valueAsNumber: true })}
                    disabled={disabled}
                    style={{ width: '64px', height: '30px', padding: '0 6px', fontSize: '0.85rem', fontWeight: 800, textAlign: 'center', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                  />
                  <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#170e5e' }}>%</span>
                </div>
              </div>

              {/* Card 9: Restaurant Tables Count (Only for Restaurants & Cafes) */}
              {isRestaurantVertical && (
                <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                    <div style={iconBadgeStyle}>
                      <RestaurantTablesIcon size={20} />
                    </div>
                    <div style={premiumCardTextStyle}>
                      <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s165', "عدد طاولات الصالة")}</strong>
                      <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {t('settings.forms.tabs.sales_inventory_settings_tab.s166', "العدد الافتراضي للطاولات المعروضة في خريطة الصالة والمطاعم")}
                      </small>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      className="purchase-prototype-field-input"
                      type="number"
                      min="1"
                      max="200"
                      step="1"
                      {...form.register('restaurantTablesCount')}
                      disabled={disabled}
                      placeholder="24"
                      style={{ width: '85px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                    />
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s167', "طاولة")}</span>
                  </div>
                </div>
              )}

              {/* Card 10: Restaurant Service Charge (Only for Restaurants & Cafes) */}
              {isRestaurantVertical && (
                <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                    <div style={iconBadgeStyle}>
                      <RestaurantServiceChargeIcon size={20} />
                    </div>
                    <div style={premiumCardTextStyle}>
                      <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s168', "رسوم خدمة الصالة التلقائية (Service Charge)")}</strong>
                      <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {t('settings.forms.tabs.sales_inventory_settings_tab.s169', "إضافة نسبة مئوية لخدمة الصالة تلقائياً عند اختيار طلب صالة (Dine-in)")}
                      </small>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={t('settings.forms.tabs.sales_inventory_settings_tab.s170', "تفعيل رسوم خدمة الصالة")}
                      {...form.register('restaurantServiceChargeEnabled')}
                      disabled={disabled}
                      style={{ cursor: 'pointer', transform: 'scale(1.2)' }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        className="purchase-prototype-field-input"
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        {...form.register('restaurantServiceChargePercent')}
                        disabled={disabled || !form.watch('restaurantServiceChargeEnabled')}
                        placeholder="12"
                        style={{ width: '70px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#64748b' }}>%</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Card 11: Guest Pagers (Only for Restaurants & Cafes) */}
              {isRestaurantVertical && (
                <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                    <div style={iconBadgeStyle}>
                      <ClockIcon size={20} />
                    </div>
                    <div style={premiumCardTextStyle}>
                      <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s171', "أجهزة بيجر المناداة للزبائن (Guest Pagers)")}</strong>
                      <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {t('settings.forms.tabs.sales_inventory_settings_tab.s172', "إظهار خانة إدخال رقم البيجر في شاشة الكاشير لتسليم أجهزة النداء للزبائن في مطاعم الخدمة الذاتية (مفعل تلقائياً للكويت والسعودية)")}
                      </small>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={t('settings.forms.tabs.sales_inventory_settings_tab.s173', "تفعيل أجهزة بيجر المناداة")}
                      {...form.register('enableGuestPagers')}
                      disabled={disabled}
                      style={{ cursor: 'pointer', transform: 'scale(1.2)' }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </FormSection>
    </>
  );
}
