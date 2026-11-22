import { useTranslation } from 'react-i18next';
import { OnlineStorefrontIcon, InstallmentsIcon, FixedAssetsIcon, TaxDeclarationIcon, DeliveryFleetIcon, LockIcon, premiumCardTextStyle, premiumCheckboxInputStyle } from './modules-settings-icons';
import { TruckIcon } from '@/shared/components/icons/AppIcons';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { CSSProperties } from 'react';

interface ModulesSettingsGridG4Props {
  isContractingVertical: boolean;
  isMaritimeVertical: boolean;
  isSuperAdmin: boolean;
  getCardStyle: (isActive: boolean, hasFeature: boolean) => CSSProperties;
  isStorefrontActive: boolean;
  hasStorefrontFeature: boolean;
  handleLockedCardClick: (title: string, planName: string, description: string) => void;
  getIconBadgeStyle: (isActive: boolean) => CSSProperties;
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  isInstallmentsActive: boolean;
  hasInstallmentsFeature: boolean;
  isFixedAssetsActive: boolean;
  hasFixedAssetsFeature: boolean;
  isTaxDeclarationActive: boolean;
  hasTaxDeclarationFeature: boolean;
  isDeliveryRepsActive: boolean;
  hasDeliveryRepsFeature: boolean;
  isVanSalesActive: boolean;
  hasVanSalesFeature: boolean;
  isWholesaleVanVertical: boolean;
}

export function ModulesSettingsGridG4({ isContractingVertical, isMaritimeVertical, isSuperAdmin, getCardStyle, isStorefrontActive, hasStorefrontFeature, handleLockedCardClick, getIconBadgeStyle, form, disabled, isInstallmentsActive, hasInstallmentsFeature, isFixedAssetsActive, hasFixedAssetsFeature, isTaxDeclarationActive, hasTaxDeclarationFeature, isDeliveryRepsActive, hasDeliveryRepsFeature, isVanSalesActive, hasVanSalesFeature, isWholesaleVanVertical }: ModulesSettingsGridG4Props) {
  const { t } = useTranslation();
  return (
    <>
      {/* المتجر الإلكتروني وطلبات الأونلاين */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label
          style={getCardStyle(Boolean(isStorefrontActive), hasStorefrontFeature)}
          onClick={(e) => {
            if (!hasStorefrontFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s129', "المتجر الإلكتروني وطلبات الأونلاين"),
                t('settings.forms.tabs.modules_settings_tab.s130', "باقة التجارة الشاملة (Omnichannel Enterprise)"),
                t('settings.forms.tabs.modules_settings_tab.s131', "يتيح لك هذا الموديول ربط متجرك بمتجر إلكتروني متكامل للعملاء، واستقبال الطلبات أونلاين وتأكيد السداد ببوابات الدفع الإلكتروني وتتبع المناديب.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isStorefrontActive))}>
              <OnlineStorefrontIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s132', "المتجر الإلكتروني وطلبات الأونلاين")}</strong>
                {!hasStorefrontFeature && (
                  <span style={{ fontSize: '0.7rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: '4px', fontWeight: 800, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s133', "باقة التجارة الشاملة")}
                  </span>
                )}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s134', "يفعّل المتجر الإلكتروني، بوابات الدفع بالبطاقات (Paymob)، واستقبال ومتابعة طلبات الأونلاين")}</small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('storefrontModuleEnabled')} checked={Boolean(isStorefrontActive)} disabled={disabled || !hasStorefrontFeature} />
        </label>
      ) : null}

      {/* مبيعات وجدولة التقسيط */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label
          style={getCardStyle(Boolean(isInstallmentsActive), hasInstallmentsFeature)}
          onClick={(e) => {
            if (!hasInstallmentsFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s135', "مبيعات وجدولة التقسيط"),
                t('settings.forms.tabs.modules_settings_tab.s136', "الباقة المتكاملة (Ultimate ERP)"),
                t('settings.forms.tabs.modules_settings_tab.s137', "يتيح لك هذا الموديول إدارة عقود وأقساط العملاء، احتساب نسب الفوائد، وجدولة وتنبيهات الأقساط المستحقة والمتأخرة.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isInstallmentsActive))}>
              <InstallmentsIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s138', "مبيعات وجدولة التقسيط")}</strong>
                {!hasInstallmentsFeature && (
                  <span style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s139', "الباقة المتكاملة")}
                  </span>
                )}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s140', "إدارة خطط التقسيط، عقود الأقساط، تتبع الأقساط المسددة والمتأخرة، وإشعارات الاستحقاق")}</small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('installmentsModuleEnabled')} checked={Boolean(isInstallmentsActive)} disabled={disabled || !hasInstallmentsFeature} />
        </label>
      ) : null}

      {/* إدارة وإهلاك الأصول الثابتة */}
      <label
        style={getCardStyle(Boolean(isFixedAssetsActive), hasFixedAssetsFeature || isContractingVertical || isMaritimeVertical)}
        onClick={(e) => {
          if (isContractingVertical || isMaritimeVertical) return;
          if (!hasFixedAssetsFeature) {
            e.preventDefault();
            handleLockedCardClick(
              t('settings.forms.tabs.modules_settings_tab.s141', "إدارة وإهلاك الأصول الثابتة"),
              t('settings.forms.tabs.modules_settings_tab.s142', "الباقة المتكاملة (Ultimate ERP)"),
              t('settings.forms.tabs.modules_settings_tab.s143', "يتيح لك هذا الموديول تسجيل الأصول والمعدات، احتساب الإهلاك التلقائي وقيود اليومية التلقائية في الحسابات العامة.")
            );
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={getIconBadgeStyle(Boolean(isFixedAssetsActive))}>
            <FixedAssetsIcon size={20} />
          </div>
          <div style={premiumCardTextStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s144', "إدارة وإهلاك الأصول الثابتة")}</strong>
              {isContractingVertical ? (
                <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('settings.forms.tabs.modules_settings_tab.s145', "مفعل تلقائياً لمعدات وأصول المقاولات")}
                </span>
              ) : isMaritimeVertical ? (
                <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('settings.forms.tabs.modules_settings_tab.s146', "مفعل تلقائياً لأصول وتجهيزات الشحن")}
                </span>
              ) : !hasFixedAssetsFeature ? (
                <span style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                  <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s147', "الباقة المتكاملة")}
                </span>
              ) : null}
            </div>
            <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s148', "سجل الأصول، احتساب الإهلاك المحاسبي، والقيمة التخريدية والدفترية ومواقع الأصول")}</small>
          </div>
        </div>
        <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('fixedAssetsModuleEnabled')} checked={Boolean(isFixedAssetsActive)} disabled={disabled || isContractingVertical || isMaritimeVertical || !hasFixedAssetsFeature} />
      </label>

      {/* الإقرار الضريبي والربط الإلكتروني */}
      <label
        style={getCardStyle(Boolean(isTaxDeclarationActive), hasTaxDeclarationFeature || isContractingVertical || isMaritimeVertical)}
        onClick={(e) => {
          if (isContractingVertical || isMaritimeVertical) return;
          if (!hasTaxDeclarationFeature) {
            e.preventDefault();
            handleLockedCardClick(
              t('settings.forms.tabs.modules_settings_tab.s149', "نموذج الإقرار الضريبي وهيئة الزكاة"),
              t('settings.forms.tabs.modules_settings_tab.s150', "الباقة المتكاملة (Ultimate ERP)"),
              t('settings.forms.tabs.modules_settings_tab.s151', "يتيح لك هذا الموديول توليد إقرارات القيمة المضافة (نموذج 10 ومطابقة ZATCA) وحساب الفوارق الضريبية بدقة.")
            );
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={getIconBadgeStyle(Boolean(isTaxDeclarationActive))}>
            <TaxDeclarationIcon size={20} />
          </div>
          <div style={premiumCardTextStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s152', "الإقرار الضريبي والربط الإلكتروني")}</strong>
              {isContractingVertical || isMaritimeVertical ? (
                <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('settings.forms.tabs.modules_settings_tab.s153', "مفعل تلقائياً للإقرار الضريبي")}
                </span>
              ) : !hasTaxDeclarationFeature ? (
                <span style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                  <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s154', "الباقة المتكاملة")}
                </span>
              ) : null}
            </div>
            <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s155', "توليد نموذج الإقرار الضريبي (ن10)، إقرارات هيئة الزكاة (ZATCA)، وتقارير ضريبة المخرجات والمدخلات")}</small>
          </div>
        </div>
        <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('taxDeclarationModuleEnabled')} checked={Boolean(isTaxDeclarationActive)} disabled={disabled || isContractingVertical || isMaritimeVertical || !hasTaxDeclarationFeature} />
      </label>

      {/* موديول مناديب التوصيل والدليفري */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label
          style={getCardStyle(Boolean(isDeliveryRepsActive), hasDeliveryRepsFeature)}
          onClick={(e) => {
            if (!hasDeliveryRepsFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s156_reps', "إدارة مناديب التوصيل والدليفري"),
                t('settings.forms.tabs.modules_settings_tab.s157', "الباقة المتكاملة (Ultimate ERP)"),
                t('settings.forms.tabs.modules_settings_tab.s158_reps', "خاص بالمحلات والمتاجر والمطاعم: إسناد الفواتير والطلبات لطياري التوصيل، متابعة الشحنات، تصفية العهد النقدية، واحتساب العمولات.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isDeliveryRepsActive))}>
              <DeliveryFleetIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s159_reps', "إدارة مناديب التوصيل والدليفري")}</strong>
                {!hasDeliveryRepsFeature && (
                  <span style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s160', "الباقة المتكاملة")}
                  </span>
                )}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s161_reps', "إسناد الطلبات للكباتن، تتبع التسليم، تصفية عهدة النقدية، وعمولات التوصيل للمحلات")}</small>
            </div>
          </div>
          <input
            type="checkbox"
            style={premiumCheckboxInputStyle}
            {...form.register('deliveryRepsModuleEnabled')}
            checked={Boolean(isDeliveryRepsActive)}
            onChange={(e) => {
              form.setValue('deliveryRepsModuleEnabled', e.target.checked, { shouldDirty: true });
            }}
            disabled={disabled || !hasDeliveryRepsFeature}
          />
        </label>
      ) : null}

      {/* موديول مبيعات وتوزيع الفان */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label
          style={getCardStyle(Boolean(isVanSalesActive), hasVanSalesFeature)}
          onClick={(e) => {
            if (!hasVanSalesFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s156_van', "مبيعات وتوزيع الفان والأسطول الميداني"),
                t('settings.forms.tabs.modules_settings_tab.s157', "الباقة المتكاملة (Ultimate ERP)"),
                t('settings.forms.tabs.modules_settings_tab.s158_van', "خاص بشركات التوزيع والجملة: مخازن السيارات المتنقلة، أذونات تحميل وتفريغ الفان، البيع المباشر من السيارة، وجرد مبيعات الفان الميدانية.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isVanSalesActive))}>
              <TruckIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s159_van', "مبيعات وتوزيع الفان (الأسطول الميداني)")}</strong>
                {isWholesaleVanVertical && (
                  <span style={{ fontSize: '0.7rem', background: '#e0e7ff', color: '#3730a3', border: '1px solid #c7d2fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    {t('settings.forms.tabs.modules_settings_tab.vertical_locked', "أساسي لنشاط الجملة")}
                  </span>
                )}
                {!hasVanSalesFeature && !isWholesaleVanVertical && (
                  <span style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s160', "الباقة المتكاملة")}
                  </span>
                )}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s161_van', "مخازن السيارات المتنقلة، أذونات التحميل والتفريغ، البيع الميداني، وتسوية الفان اليومية")}</small>
            </div>
          </div>
          <input
            type="checkbox"
            style={premiumCheckboxInputStyle}
            {...form.register('vanSalesModuleEnabled')}
            checked={Boolean(isVanSalesActive)}
            onChange={(e) => {
              form.setValue('vanSalesModuleEnabled', e.target.checked, { shouldDirty: true });
            }}
            disabled={disabled || isWholesaleVanVertical || !hasVanSalesFeature}
          />
        </label>
      ) : null}
    </>
  );
}
