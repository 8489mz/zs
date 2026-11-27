import { useTranslation } from 'react-i18next';
import { MaintenanceWrenchIcon, PharmacyCrossIcon, VariantsLayersIcon, WrenchServiceIcon, ScaleIcon, EnterpriseIcon, LockIcon, premiumCardTextStyle, premiumCheckboxInputStyle } from './modules-settings-icons';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type {CSSProperties, Dispatch, SetStateAction} from 'react';

interface ModulesSettingsGridG3Props {
  isContractingVertical: boolean;
  isMaritimeVertical: boolean;
  isSuperAdmin: boolean;
  getCardStyle: (isActive: boolean, hasFeature: boolean) => CSSProperties;
  isMaintenanceActive: boolean;
  hasMaintenanceFeature: boolean;
  handleLockedCardClick: (title: string, planName: string, description: string) => void;
  getIconBadgeStyle: (isActive: boolean) => CSSProperties;
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  setProfileModalOpen: Dispatch<SetStateAction<boolean>>;
  disabled: boolean;
  isPharmacyActive: boolean;
  hasPharmacyFeature: boolean;
  isClothingActive: boolean;
  hasClothingFeature: boolean;
  isServicesActive: boolean;
  hasServicesFeature: boolean;
  isWeightedActive: boolean;
  isEnterpriseActive: boolean;
  hasEnterpriseFeature: boolean;
  isManufacturingVertical: boolean;
  isWholesaleVanVertical: boolean;
  isWarehousingVertical: boolean;
}

export function ModulesSettingsGridG3({ isContractingVertical, isMaritimeVertical, isSuperAdmin, getCardStyle, isMaintenanceActive, hasMaintenanceFeature, handleLockedCardClick, getIconBadgeStyle, form, setProfileModalOpen, disabled, isPharmacyActive, hasPharmacyFeature, isClothingActive, hasClothingFeature, isServicesActive, hasServicesFeature, isWeightedActive, isEnterpriseActive, hasEnterpriseFeature, isManufacturingVertical, isWholesaleVanVertical, isWarehousingVertical }: ModulesSettingsGridG3Props) {
  const { t } = useTranslation();
  return (
    <>
      {/* ===== موديول إدارة الصيانة الشامل مع محدد الأنشطة ===== */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label
          style={getCardStyle(Boolean(isMaintenanceActive), hasMaintenanceFeature)}
          onClick={(e) => {
            if (!hasMaintenanceFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s95', "موديول إدارة الصيانة والأجهزة"),
                t('settings.forms.tabs.modules_settings_tab.s96', "الباقة المتكاملة (Ultimate ERP)"),
                t('settings.forms.tabs.modules_settings_tab.s97', "يتيح لك هذا الموديول إدارة كروت الصيانة، تتبع السيريال IMEI، فحص الضمان، وحساب أجور الفنيين.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isMaintenanceActive))}>
              <MaintenanceWrenchIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s98', "موديول إدارة الصيانة والأجهزة")}</strong>
                {!hasMaintenanceFeature && (
                  <span style={{ fontSize: '0.7rem', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s99', "الباقة المتكاملة")}
                  </span>
                )}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s100', "يفعّل تتبع السيريال، استلام الأجهزة، فحص الضمان، وحساب المصنعية")}</small>
            </div>
          </div>
          <input
            type="checkbox"
            style={premiumCheckboxInputStyle}
            {...form.register('enableMobileStoreFeatures', {
              onChange: (e) => {
                if (e.target.checked) {
                  if (!form.getValues('maintenanceProfile')) {
                    form.setValue('maintenanceProfile', 'mobile', { shouldDirty: true });
                  }
                  setProfileModalOpen(true);
                }
              }
            })}
            checked={Boolean(isMaintenanceActive)}
            disabled={disabled || !hasMaintenanceFeature}
          />
        </label>
      ) : null}

      {/* موديول الصيدليات والأدوية */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label
          style={getCardStyle(Boolean(isPharmacyActive), hasPharmacyFeature)}
          onClick={(e) => {
            if (!hasPharmacyFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s101', "موديول الصيدليات والأدوية"),
                t('settings.forms.tabs.modules_settings_tab.s102', "الباقة المتكاملة (Ultimate ERP)"),
                t('settings.forms.tabs.modules_settings_tab.s103', "يتيح لك هذا الموديول إدارة دليل الأدوية والمواد الفعالة، تتبع التشغيلات والصلاحيات، وإدارة النواقص.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isPharmacyActive))}>
              <PharmacyCrossIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s104', "موديول الصيدليات والأدوية")}</strong>
                {!hasPharmacyFeature && (
                  <span style={{ fontSize: '0.7rem', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s105', "الباقة المتكاملة")}
                  </span>
                )}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s106', "دليل الأدوية، المواد الفعالة والمثائل، الروشتات والتأمين، الصلاحيات ونواقص الأدوية")}</small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('enablePharmacyModule')} checked={Boolean(isPharmacyActive)} disabled={disabled || !hasPharmacyFeature} />
        </label>
      ) : null}

      {/* موديول المتغيرات والأصناف المتعددة */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label
          style={getCardStyle(Boolean(isClothingActive), hasClothingFeature)}
          onClick={(e) => {
            if (!hasClothingFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s107', "موديول المتغيرات والأصناف المتعددة"),
                t('settings.forms.tabs.modules_settings_tab.s108', "الباقة المتكاملة (Ultimate ERP)"),
                t('settings.forms.tabs.modules_settings_tab.s109', "يتيح لك هذا الموديول إدارة مصفوفة المقاسات والألوان وطباعة باركودات الأصناف المتعددة.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isClothingActive))}>
              <VariantsLayersIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s110', "موديول المتغيرات والأصناف المتعددة")}</strong>
                {!hasClothingFeature && (
                  <span style={{ fontSize: '0.7rem', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s111', "الباقة المتكاملة")}
                  </span>
                )}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s112', "يفعّل إدارة الأصناف ذات الخصائص المتعددة (مقاسات، ألوان، نكهات، أحجام، روائح...)")}</small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('clothingModuleEnabled')} checked={Boolean(isClothingActive)} disabled={disabled || !hasClothingFeature} />
        </label>
      ) : null}

      {/* موديول الخدمات والمصنعيات */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label
          style={getCardStyle(Boolean(isServicesActive), hasServicesFeature)}
          onClick={(e) => {
            if (!hasServicesFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s113', "الخدمات والمصنعيات"),
                t('settings.forms.tabs.modules_settings_tab.s114', "باقة النمو (الاحترافية)"),
                t('settings.forms.tabs.modules_settings_tab.s115', "يتيح لك هذا الموديول إدارة الخدمات السريعة، مصنعيات الصيانة البسيطة، وإصدار فواتير الخدمات غير المخزنية وعمولات الفنيين.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isServicesActive))}>
              <WrenchServiceIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s116', "الخدمات والمصنعيات")}</strong>
                {!hasServicesFeature && (
                  <span style={{ fontSize: '0.7rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s117', "باقة النمو")}
                  </span>
                )}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s118', "يفعّل تابة إدارة الخدمات السريعة، المصنعيات، والخدمات غير المخزنية")}</small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('servicesModuleEnabled')} checked={Boolean(isServicesActive)} disabled={disabled || !hasServicesFeature} />
        </label>
      ) : null}

      {/* باركود الميزان */}
      <label style={getCardStyle(Boolean(isWeightedActive), true)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={getIconBadgeStyle(Boolean(isWeightedActive))}>
            <ScaleIcon size={20} />
          </div>
          <div style={premiumCardTextStyle}>
            <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s119', "باركود الميزان")}</strong>
            <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s120', "باركود مضمّن فيه الوزن أو السعر مباشرةً للأوزان")}</small>
          </div>
        </div>
        <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('weightedBarcodeEnabled')} checked={Boolean(isWeightedActive)} disabled={disabled} />
      </label>

      {/* موديول الشركات والمحاسبة المتقدمة */}
      <label
        style={getCardStyle(Boolean(isEnterpriseActive), hasEnterpriseFeature || isContractingVertical || isMaritimeVertical)}
        onClick={(e) => {
          if (isContractingVertical || isMaritimeVertical || isManufacturingVertical || isWholesaleVanVertical || isWarehousingVertical) return;
          if (!hasEnterpriseFeature) {
            e.preventDefault();
            handleLockedCardClick(
              t('settings.forms.tabs.modules_settings_tab.s121', "موديول الشركات والمحاسبة المتقدمة"),
              t('settings.forms.tabs.modules_settings_tab.s122', "الباقة المتكاملة (Ultimate ERP)"),
              t('settings.forms.tabs.modules_settings_tab.s123', "يتيح لك هذا الموديول دليل الحسابات الشجري، ميزان المراجعة، مراكز التكلفة، القيود اليومية، والقوائم المالية.")
            );
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={getIconBadgeStyle(Boolean(isEnterpriseActive))}>
            <EnterpriseIcon size={20} />
          </div>
          <div style={premiumCardTextStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s124', "موديول الشركات والمحاسبة المتقدمة")}</strong>
              {isContractingVertical ? (
                <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('settings.forms.tabs.modules_settings_tab.s125', "مفعل تلقائياً لمراكز تكلفة المشاريع")}
                </span>
              ) : isMaritimeVertical ? (
                <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('settings.forms.tabs.modules_settings_tab.s126', "مفعل تلقائياً لمحاسبة الشحن ومراكز التكلفة")}
                </span>
              ) : isManufacturingVertical || isWholesaleVanVertical || isWarehousingVertical ? (
                <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('settings.forms.tabs.modules_settings_tab.s191', "مفعل تلقائياً لقطاع المنشأة")}
                </span>
              ) : !hasEnterpriseFeature ? (
                <span style={{ fontSize: '0.7rem', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                  <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s127', "الباقة المتكاملة")}
                </span>
              ) : null}
            </div>
            <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s128', "يفعّل مراكز التكلفة، ربط الفواتير بالمشاريع أو الشحنات، وشروط التعاقد")}</small>
          </div>
        </div>
        <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('enableEnterpriseFeatures')} checked={Boolean(isEnterpriseActive)} disabled={disabled || isContractingVertical || isMaritimeVertical || isManufacturingVertical || isWholesaleVanVertical || isWarehousingVertical || !hasEnterpriseFeature} />
      </label>
    </>
  );
}
