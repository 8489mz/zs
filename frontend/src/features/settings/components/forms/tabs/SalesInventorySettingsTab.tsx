import { useTranslation } from 'react-i18next';
import { memo } from 'react';
import { LightbulbIcon } from '@/shared/components/icons/AppIcons';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';
import type { PosTerminalDeviceConfig } from '@/types/domain-models/settings';
import { FormSection } from '@/shared/components/form-section';
import { CustomSelect } from '@/shared/ui/custom-select';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { TaxCalcIcon, NegativeStockIcon, ZeroCostIcon, LowStockIndicatorIcon, IssueModeDocIcon, premiumCardStyle, iconBadgeStyle, premiumCardTextStyle, premiumCheckboxInputStyle, fieldControlStyle } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-shared';
import { SalesInventorySalesTax } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-sales-tax';
import { ContractingVerticalSection, MaritimeVerticalSection, ImportVerticalSection, ServicesVerticalSection, ManufacturingVerticalSection } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-verticals';
import { SalesInventoryRules, useSalesInventoryRulesState } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-rules';
import { SalesInventoryBarcode } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-barcode';
import { SalesInventoryPosCustom } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-pos-custom';
import { SalesInventoryZpay } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-zpay';
import { useSalesInventoryTerminals } from '@/features/settings/components/forms/tabs/sales-inventory/use-sales-inventory-terminals';
import { SalesInventoryTerminals } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-terminals';

interface SalesInventoryTabProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  activeTab: string;
  settings?: AppSettings;
}
function ExpiryAlertIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="12" y1="14" x2="12" y2="17" />
      <line x1="12" y1="19" x2="12.01" y2="19" />
    </svg>
  );
}

function StagnantStockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
      <circle cx="18" cy="18" r="3" fill="#fef3c7" stroke="#d97706" />
      <polyline points="18 16.5 18 18 19 18" stroke="#d97706" />
    </svg>
  );
}

function LoyaltyPointsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export const SalesInventorySettingsTab = memo(function SalesInventorySettingsTab({
  form,
  disabled,
  activeTab,
  settings,
}: SalesInventoryTabProps) {
  const { t: __t } = useTranslation();
  // INV-FE3-FRONTEND-BOOK-DIGITS: the live loyalty preview (points ×
  // redeem value) is money; it rounds at the tenant's book digits, not
  // hardcoded 2dp. (The redeem rate % rendered with it is a percent and
  // keeps 1dp.)
  const loyaltyBookDigits = currencyMoneyDigits(getGlobalSystemCurrency());
  const loyaltyPreviewPoints = Math.floor((1000 / 100) * Number(form.watch('loyaltyPointsPer100Egp') || 10));
  const loyaltyPreviewValue = roundMoneyValue(loyaltyPreviewPoints * Number(form.watch('loyaltyPointRedeemValue') || 0.1), loyaltyBookDigits);
  const rawActivity = String(form.watch('businessIndustry') || settings?.businessIndustry || (settings as any)?.activityType || 'retail_general').trim().toLowerCase();
  const isContractingVertical = rawActivity === 'contracting' || rawActivity === 'construction' || rawActivity === 'مقاولات' || Boolean(form.watch('contractingModuleEnabled'));
  const isMaritimeVertical = rawActivity === 'maritime_freight' || rawActivity === 'maritime' || rawActivity === 'freight' || rawActivity === 'shipping' || rawActivity === 'شحن' || Boolean(form.watch('maritimeFreightModuleEnabled'));
  const isManufacturingVertical = rawActivity === 'manufacturing' || rawActivity === 'production' || rawActivity === 'تصنيع' || rawActivity === 'مصنع' || Boolean(form.watch('manufacturingModuleEnabled'));
  const isServicesVertical = rawActivity === 'services' || rawActivity === 'consulting' || rawActivity === 'استشارات';
  const isImportVertical = rawActivity === 'import_export' || rawActivity === 'import';
  const isRestaurantVertical = ['restaurant', 'cafe', 'مطعم', 'كافيه'].includes(rawActivity) || Boolean(form.watch('restaurantModuleEnabled'));
  const isRetailCommerce = !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isServicesVertical;
  const weightedBarcodeEnabled = Boolean(form.watch('weightedBarcodeEnabled'));
  const isPosModuleEnabled = Boolean(form.watch('posModuleEnabled') ?? settings?.posModuleEnabled ?? true);
  const showPosSettings = isPosModuleEnabled && isRetailCommerce;
  const showPhysicalInventory = !isServicesVertical;

  const isStoreFleet = form.watch('deliveryFeeMode') === 'store_fleet';
  const rules = useSalesInventoryRulesState();
  const terminals = useSalesInventoryTerminals({ form, settings });

  return (
    <div style={{ display: activeTab === 'sales_inventory' ? 'block' : 'none' }}>
      <SalesInventorySalesTax form={form} disabled={disabled} settings={settings} />
      {isContractingVertical && (
        <ContractingVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isMaritimeVertical && (
        <MaritimeVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isImportVertical && (
        <ImportVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isServicesVertical && (
        <ServicesVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isManufacturingVertical && (
        <ManufacturingVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isRetailCommerce && (
        <SalesInventoryRules form={form} disabled={disabled} settings={settings} isRestaurantVertical={isRestaurantVertical} showPosSettings={showPosSettings} showPhysicalInventory={showPhysicalInventory} isStoreFleet={isStoreFleet} isChangingPin={rules.isChangingPin} setIsChangingPin={rules.setIsChangingPin} />
      )}
      {weightedBarcodeEnabled ? (
        <SalesInventoryBarcode form={form} disabled={disabled} settings={settings} weightedBarcodeEnabled={weightedBarcodeEnabled} />
      ) : null}

      {showPosSettings && (
        <SalesInventoryPosCustom form={form} disabled={disabled} settings={settings} showPosSettings={showPosSettings} />
      )}

      {showPosSettings && (
        <SalesInventoryZpay form={form} disabled={disabled} settings={settings} showPosSettings={showPosSettings} />
      )}

      {showPosSettings && (
        <SalesInventoryTerminals form={form} disabled={disabled} settings={settings} showPosSettings={showPosSettings} testingTerminalId={terminals.testingTerminalId} terminalTestResults={terminals.terminalTestResults} isMasterPosTerminalEnabled={terminals.isMasterPosTerminalEnabled} setIsMasterPosTerminalEnabled={terminals.setIsMasterPosTerminalEnabled} terminalsList={terminals.terminalsList} handleUpdateTerminal={terminals.handleUpdateTerminal} handleAddTerminal={terminals.handleAddTerminal} handleRemoveTerminal={terminals.handleRemoveTerminal} handleSetDefaultTerminal={terminals.handleSetDefaultTerminal} handleTestTerminalDevice={terminals.handleTestTerminalDevice} />
      )}

      {/* ===== برنامج نقاط وولاء العملاء ===== */}
      {showPosSettings && (
        <FormSection
          title={__t('settings.forms.tabs.sales_inventory_settings_tab.s212', "برنامج نقاط ومكافآت ولاء العملاء (Customer Loyalty Program)")}
          description={__t('settings.forms.tabs.sales_inventory_settings_tab.s213', "تحفيز العملاء على الشراء المتكرر عبر منحهم نقاطاً مع كل فاتورة، وإمكانية استبدالها برصيد وخصم فوري في الفواتير التالية.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
            {/* 1. Toggle Loyalty */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <LoyaltyPointsIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s214', "تفعيل برنامج نقاط الولاء")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s215', "احتساب نقاط تلقائياً للعميل عند البيع وإتاحة استبدالها في الكاشير")}</small>
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
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s216', "إظهار رصيد النقاط في الفاتورة")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s217', "طباعة النقاط المكتسبة والرصيد الإجمالي في الإيصالات الحرارية وفواتير A4")}</small>
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
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s218', "معدل اكتساب النقاط")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s219', "عدد النقاط المكتسبة لكل 100 جنيه مشتريات مسددة:")}</small>
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
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s220', "نقطة")}</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '4px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                {[
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s221', "5 نقاط"), val: 5 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s222', "10 نقاط"), val: 10 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s223', "20 نقطة"), val: 20 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s224', "50 نقطة"), val: 50 },
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
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s225', "قيمة النقطة عند الاستبدال")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s226', "القيمة المالية للنقطة الواحدة كخصم بالجنيه:")}</small>
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
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s227', "0.05 ج (5 قروش)"), val: 0.05 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s228', "0.10 ج (10 قروش)"), val: 0.1 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s229', "0.50 ج (نصف جنيه)"), val: 0.5 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s230', "1.00 ج (جنيه كامل)"), val: 1 },
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
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s231', "الحد الأدنى للنقاط للاستبدال")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s232', "أقل رصيد نقاط يجب أن يمتلكه العميل ليتمكن من الخصم")}</small>
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
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s233', "نقطة")}</span>
              </div>
            </div>

            {/* 6. Max Discount Percentage */}
            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <TaxCalcIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s234', "سقف الخصم بالنقاط من الفاتورة")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s235', "أقصى نسبة مئوية مسموح بخصمها من إجمالي الفاتورة عبر النقاط")}</small>
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
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s236', "معاينة حية للمحرك: مشتريات بقيمة")} <strong>1,000 <CurrencySymbol /></strong> {__t('settings.forms.tabs.sales_inventory_settings_tab.s237', "تمنح العميل")}{' '}
                  <strong style={{ color: '#170e5e' }}>
                    {loyaltyPreviewPoints} {__t('settings.forms.tabs.sales_inventory_settings_tab.s238', "نقطة")}
                  </strong>{' '}
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s239', "قيمتها")}{' '}
                  <strong style={{ color: '#170e5e' }}>
                    {loyaltyPreviewValue.toFixed(loyaltyBookDigits)} <CurrencySymbol />
                  </strong>{' '}
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s240', "خصم فوري في مشترياته القادمة (معدل استرجاع")}{' '}
                  <strong>
                    {(((Math.floor((1000 / 100) * Number(form.watch('loyaltyPointsPer100Egp') || 10)) * Number(form.watch('loyaltyPointRedeemValue') || 0.1)) / 1000) * 100).toFixed(1)}%
                  </strong>).
                </span>
              </div>
            </div>
          ) : null}
        </FormSection>
      )}

      {/* ===== تنبيهات الصلاحية والأصناف الراكدة (تجزئة وتجارة عامة فقط) ===== */}
      {isRetailCommerce && (
        <FormSection
          title={__t('settings.forms.tabs.sales_inventory_settings_tab.s241', "تنبيهات الصلاحية وحركة المخزون الراكد")}
          description={__t('settings.forms.tabs.sales_inventory_settings_tab.s242', "تخصيص الفترات الزمنية لتنبيهات قرب انتهاء صلاحية المنتجات وتحديد متى يُصنف الصنف كـ 'راكد' في لوحة التحكم والتقارير.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
            {/* Card: Expiry Alert Days */}
            <div style={{ ...premiumCardStyle, cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <ExpiryAlertIcon size={20} />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s243', "تنبيه قرب انتهاء الصلاحية")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s244', "إظهار تنبيهات وتصنيف الأصناف كـ \"وشيكة الانتهاء\" قبل انتهاء تاريخها بـ:")}</small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    className="purchase-prototype-field-input"
                    type="number"
                    min="1"
                    {...form.register('expiryAlertDays')}
                    disabled={disabled}
                    placeholder="30"
                    style={{ width: '75px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1.5px solid #cbd5e1' }}
                  />
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s245', "يوم")}</span>
                </div>
              </div>
              {/* Quick Presets */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '4px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                {[
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s246', "15 يوم"), days: 15 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s247', "30 يوم"), days: 30 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s248', "60 يوم"), days: 60 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s249', "90 يوم"), days: 90 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s250', "180 يوم"), days: 180 },
                ].map((p) => {
                  const currentVal = Number(form.watch('expiryAlertDays') || 30);
                  const isSelected = currentVal === p.days;
                  return (
                    <button
                      key={p.days}
                      type="button"
                      onClick={() => form.setValue('expiryAlertDays', p.days, { shouldDirty: true, shouldValidate: true })}
                      disabled={disabled}
                      style={{
                        padding: '4px 2px',
                        fontSize: '0.71rem',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
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

            {/* Card: Stagnant Product Days */}
            <div style={{ ...premiumCardStyle, cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <StagnantStockIcon size={20} />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s251', "معيار الأصناف الراكدة")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s252', "تصنيف الصنف كـ \"راكد\" في لوحة التحكم والتقارير إذا لم يُبَع منه منذ:")}</small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    className="purchase-prototype-field-input"
                    type="number"
                    min="1"
                    {...form.register('stagnantProductDays')}
                    disabled={disabled}
                    placeholder="30"
                    style={{ width: '75px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1.5px solid #cbd5e1' }}
                  />
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s253', "يوم")}</span>
                </div>
              </div>
              {/* Quick Presets */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '4px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                {[
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s254', "30 يوم"), days: 30 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s255', "60 يوم"), days: 60 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s256', "90 يوم"), days: 90 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s257', "120 يوم"), days: 120 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s258', "180 يوم"), days: 180 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s259', "365 يوم"), days: 365 },
                ].map((p) => {
                  const currentVal = Number(form.watch('stagnantProductDays') || 30);
                  const isSelected = currentVal === p.days;
                  return (
                    <button
                      key={p.days}
                      type="button"
                      onClick={() => form.setValue('stagnantProductDays', p.days, { shouldDirty: true, shouldValidate: true })}
                      disabled={disabled}
                      style={{
                        padding: '4px 2px',
                        fontSize: '0.71rem',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
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
          </div>
        </FormSection>
      )}
    </div>
  );
}, (prev, next) => {
  // Freeze inactive tab to preserve 0ms switching performance
  if (prev.activeTab !== 'sales_inventory' && next.activeTab !== 'sales_inventory') {
    return true;
  }
  return false;
});
