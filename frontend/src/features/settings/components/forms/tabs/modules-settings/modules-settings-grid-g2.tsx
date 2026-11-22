import { useTranslation } from 'react-i18next';
import { CargoShipIcon, ContractingBuildingIcon, UtensilsIcon, TableCustomerIcon, LockIcon, premiumCardTextStyle, premiumCheckboxInputStyle } from './modules-settings-icons';
import { PhoneCallIcon } from '@/shared/components/icons/AppIcons';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { CSSProperties } from 'react';

interface ModulesSettingsGridG2Props {
  isContractingVertical: boolean;
  isMaritimeVertical: boolean;
  isSuperAdmin: boolean;
  getCardStyle: (isActive: boolean, hasFeature: boolean) => CSSProperties;
  isImportActive: boolean;
  hasImportFeature: boolean;
  handleLockedCardClick: (title: string, planName: string, description: string) => void;
  getIconBadgeStyle: (isActive: boolean) => CSSProperties;
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  hasMaritimeFreightFeature: boolean;
  isMaritimeFreightActive: boolean;
  hasContractingFeature: boolean;
  isContractingActive: boolean;
  isRestaurantActive: boolean;
  hasRestaurantFeature: boolean;
  isPhoneOrdersActive: boolean;
  isPosMetaActive: boolean;
  hasPosMetaFeature: boolean;
}

export function ModulesSettingsGridG2({ isContractingVertical, isMaritimeVertical, isSuperAdmin, getCardStyle, isImportActive, hasImportFeature, handleLockedCardClick, getIconBadgeStyle, form, disabled, hasMaritimeFreightFeature, isMaritimeFreightActive, hasContractingFeature, isContractingActive, isRestaurantActive, hasRestaurantFeature, isPhoneOrdersActive, isPosMetaActive, hasPosMetaFeature }: ModulesSettingsGridG2Props) {
  const { t } = useTranslation();
  return (
    <>
      {/* موديول الاستيراد والشراكة */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label
          style={getCardStyle(Boolean(isImportActive), hasImportFeature)}
          onClick={(e) => {
            if (!hasImportFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s61', "موديول الاستيراد والشراكة"),
                t('settings.forms.tabs.modules_settings_tab.s62', "الباقة المتكاملة (Ultimate ERP)"),
                t('settings.forms.tabs.modules_settings_tab.s63', "يتيح لك هذا الموديول إدارة ومتابعة الحاويات والشحنات الدولية، وتوزيع أرباح وتكاليف الشركاء.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isImportActive))}>
              <CargoShipIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s64', "موديول الاستيراد والشراكة")}</strong>
                {!hasImportFeature && (
                  <span style={{ fontSize: '0.7rem', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s65', "الباقة المتكاملة")}
                  </span>
                )}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s66', "يفعّل إدارة الحاويات، مسير الشحن، وتوزيع الأرباح")}</small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('importModuleEnabled')} checked={Boolean(isImportActive)} disabled={disabled || !hasImportFeature} />
        </label>
      ) : null}

      {/* موديول الشحن واللوجستيات */}
      {isMaritimeVertical || (!isContractingVertical && (hasMaritimeFreightFeature || isSuperAdmin)) ? (
        <label
          style={getCardStyle(Boolean(isMaritimeFreightActive), hasMaritimeFreightFeature || isMaritimeVertical)}
          onClick={(e) => {
            if (isMaritimeVertical) return;
            if (!hasMaritimeFreightFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s67', "موديول الشحن واللوجستيات"),
                t('settings.forms.tabs.modules_settings_tab.s68', "الباقة المتكاملة (Ultimate ERP)"),
                t('settings.forms.tabs.modules_settings_tab.s69', "يتيح لك هذا الموديول إدارة طلبات تسعير الشحن، مقارنة عروض الأسعار، إصدار عروض أسعار العملاء، أوامر الشحن والعمليات، وتتبع الحاويات.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isMaritimeFreightActive))}>
              <CargoShipIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s70', "موديول الشحن واللوجستيات")}</strong>
                {isMaritimeVertical ? (
                  <span style={{ fontSize: '0.7rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                    {t('settings.forms.tabs.modules_settings_tab.s71', "الموديول السيادي الأساسي للنشاط")}
                  </span>
                ) : !hasMaritimeFreightFeature ? (
                  <span style={{ fontSize: '0.7rem', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s72', "الباقة المتكاملة")}
                  </span>
                ) : null}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s73', "يفعّل إدارة طلبات التسعير، عروض الأسعار، أوامر الشحن والعمليات، وتتبع الحاويات")}</small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('maritimeFreightModuleEnabled')} checked={Boolean(isMaritimeFreightActive)} disabled={disabled || isMaritimeVertical || !hasMaritimeFreightFeature} />
        </label>
      ) : null}

      {/* موديول المقاولات والمشاريع */}
      {isContractingVertical || (!isMaritimeVertical && (hasContractingFeature || isSuperAdmin)) ? (
        <label
          style={getCardStyle(Boolean(isContractingActive), hasContractingFeature || isContractingVertical)}
          onClick={(e) => {
            if (isContractingVertical) return;
            if (!hasContractingFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s74', "موديول المقاولات والمشاريع"),
                t('settings.forms.tabs.modules_settings_tab.s75', "الباقة المتكاملة (Ultimate ERP)"),
                t('settings.forms.tabs.modules_settings_tab.s76', "يتيح لك هذا الموديول إدارة مشاريع المقاولات، جداول الكميات SOV/BOQ، الأوامر التغييرية، مستخلصات الدفع الدورية AIA G702/G703، ومقاولي الباطن واليوميات الميدانية.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isContractingActive))}>
              <ContractingBuildingIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s77', "موديول المقاولات والمشاريع")}</strong>
                {isContractingVertical ? (
                  <span style={{ fontSize: '0.7rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                    {t('settings.forms.tabs.modules_settings_tab.s78', "الموديول السيادي الأساسي للنشاط")}
                  </span>
                ) : !hasContractingFeature ? (
                  <span style={{ fontSize: '0.7rem', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s79', "الباقة المتكاملة")}
                  </span>
                ) : null}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s80', "إدارة المشاريع، جداول الكميات، الأوامر التغييرية، المستخلصات الجارية، ومقاولو الباطن")}</small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('contractingModuleEnabled')} checked={Boolean(isContractingActive)} disabled={disabled || isContractingVertical || !hasContractingFeature} />
        </label>
      ) : null}

      {/* موديول المطاعم والكافيهات */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label
          style={getCardStyle(Boolean(isRestaurantActive), hasRestaurantFeature)}
          onClick={(e) => {
            if (!hasRestaurantFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s81', "موديول المطاعم والكافيهات"),
                t('settings.forms.tabs.modules_settings_tab.s82', "الباقة المتكاملة (Ultimate ERP)"),
                t('settings.forms.tabs.modules_settings_tab.s83', "يتيح لك هذا الموديول إدارة الطاولات، شاشات المطبخ KDS، إضافات الوجبات، وتوزيع طلبات الصالة والدليفري.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isRestaurantActive))}>
              <UtensilsIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s84', "موديول المطاعم والكافيهات")}</strong>
                {!hasRestaurantFeature && (
                  <span style={{ fontSize: '0.7rem', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s85', "الباقة المتكاملة")}
                  </span>
                )}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s86', "يفعّل نظام الطاولات والمطبخ وأنواع الطلبات")}</small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('restaurantModuleEnabled')} checked={Boolean(isRestaurantActive)} disabled={disabled || !hasRestaurantFeature} />
        </label>
      ) : null}

      {/* مكتب طلبات الهاتف والتوصيل السريع */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label
          style={getCardStyle(Boolean(isPhoneOrdersActive), true)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isPhoneOrdersActive))}>
              <PhoneCallIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s87', "مكتب طلبات الهاتف والتوصيل السريع (Call Center)")}</strong>
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s88', "يفعّل نافذة طلبات التوصيل وكاشف المتصل (Caller ID) واختصار F7 في نقاط البيع")}</small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('phoneOrdersModuleEnabled')} checked={Boolean(isPhoneOrdersActive)} disabled={disabled} />
        </label>
      ) : null}

      {/* اختيار الطاولة والعميل بالكاشير */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label
          style={getCardStyle(Boolean(isPosMetaActive), hasPosMetaFeature && isRestaurantActive)}
          onClick={(e) => {
            if (!hasPosMetaFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s89', "اختيار الطاولة والعميل بالكاشير"),
                t('settings.forms.tabs.modules_settings_tab.s90', "الباقة المتكاملة (Ultimate ERP)"),
                t('settings.forms.tabs.modules_settings_tab.s91', "يتيح لك هذا الخيار إظهار حقول العميل ورقم الطاولة أعلى السلة مباشرة لتسريع الفوترة وتوزيع الطلبات والخدمة السريعة.")
              );
            } else if (!isRestaurantActive) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s89', "اختيار الطاولة والعميل بالكاشير"),
                t('settings.forms.tabs.modules_settings_tab.s84', "موديول المطاعم والكافيهات"),
                t('settings.forms.tabs.modules_settings_tab.s94_req', "هذا الخيار خاص بنظام المطاعم والكافيهات، ويتطلب تفعيل موديول المطاعم أولاً لإظهار الطاولات والعميل بالسلة.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isPosMetaActive))}>
              <TableCustomerIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s92', "اختيار الطاولة والعميل بالكاشير")}</strong>
                {!hasPosMetaFeature ? (
                  <span style={{ fontSize: '0.7rem', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s93', "الباقة المتكاملة")}
                  </span>
                ) : !isRestaurantActive ? (
                  <span style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    {t('settings.forms.tabs.modules_settings_tab.requires_restaurant', "يتطلب موديول المطاعم")}
                  </span>
                ) : null}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s94', "يظهر حقول العميل والطاولة أعلى السلة لتسهيل الاختيار قبل الدفع")}</small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posShowCartMeta')} checked={Boolean(isPosMetaActive)} disabled={disabled || !hasPosMetaFeature || !isRestaurantActive} />
        </label>
      ) : null}
    </>
  );
}
