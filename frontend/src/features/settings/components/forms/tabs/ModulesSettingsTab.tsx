import { useTranslation } from 'react-i18next';
import { useState, memo } from 'react';
import { Link } from 'react-router-dom';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import { FormSection } from '@/shared/components/form-section';
import { LightbulbIcon, XIcon, CheckIcon, StarIcon, ChevronDownIcon } from '@/shared/components/icons/AppIcons';
import { useHasFeature } from '@/shared/hooks/use-permission';
import { useAuthStore } from '@/stores/auth-store';
import { isDesktopOfflineApp, canManagePlatformModules } from '@/app/router/access';
import { DialogShell } from '@/shared/components/dialog-shell';
import { MAINTENANCE_PROFILES, getMaintenanceProfile, type MaintenanceProfileKey } from '@/features/maintenance/constants/maintenance-profiles';
import { IndustryModeSelectorCard } from '@/features/settings/components/workspace-sections/IndustryModeSelectorCard';
import { LockIcon, MaintenanceWrenchIcon, ProfileVectorIcon } from './modules-settings/modules-settings-icons';
import { ModulesSettingsContractingBanner } from './modules-settings/modules-settings-contracting-banner';
import { ModulesSettingsMaritimeBanner } from './modules-settings/modules-settings-maritime-banner';
import { ModulesSettingsManufacturingBanner } from './modules-settings/modules-settings-manufacturing-banner';
import { ModulesSettingsOperationMode } from './modules-settings/modules-settings-operation-mode';
import { ModulesSettingsAppsStore } from './modules-settings/modules-settings-apps-store';
import { ModulesSettingsGridG1 } from './modules-settings/modules-settings-grid-g1';
import { ModulesSettingsGridG2 } from './modules-settings/modules-settings-grid-g2';
import { ModulesSettingsGridG3 } from './modules-settings/modules-settings-grid-g3';
import { ModulesSettingsGridG4 } from './modules-settings/modules-settings-grid-g4';
import { ModulesSettingsMaintenanceProfile } from './modules-settings/modules-settings-maintenance-profile';

interface ModulesTabProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  activeTab: string;
}


export const ModulesSettingsTab = memo(function ModulesSettingsTab({ form, disabled, activeTab }: ModulesTabProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const isSuperAdmin = canManagePlatformModules(user) || (user?.role === 'super_admin' && String(user?.username || '').trim().toLowerCase() === 'zs');

  const rawActivity = String(tenant?.activityType || tenant?.pillar || form.watch('businessIndustry') || form.watch('activityType') || 'retail_general').trim().toLowerCase();
  const isContractingVertical = rawActivity === 'contracting' || rawActivity === 'construction' || rawActivity === 'مقاولات';
  const isMaritimeVertical = rawActivity === 'maritime_freight' || rawActivity === 'maritime' || rawActivity === 'freight' || rawActivity === 'shipping' || rawActivity === 'شحن';
  const isManufacturingVertical = rawActivity === 'manufacturing' || rawActivity === 'production' || rawActivity === 'تصنيع' || rawActivity === 'مصنع';
  const isWholesaleVanVertical = rawActivity === 'wholesale_van' || rawActivity === 'wholesale' || rawActivity === 'distribution' || rawActivity.includes('توزيع') || rawActivity.includes('فان') || rawActivity.includes('جمل');
  const isWarehousingVertical = rawActivity === 'warehousing' || rawActivity === 'warehouse' || rawActivity === 'wms' || rawActivity.includes('مخازن') || rawActivity.includes('مستودع');
  const isImportVertical = rawActivity === 'import_export' || rawActivity === 'import' || rawActivity.includes('استيراد');

  const hasManufacturingFeature = useHasFeature('manufacturing') || isManufacturingVertical || isSuperAdmin;
  const hasImportFeature = useHasFeature('import') || isImportVertical || isSuperAdmin;
  const hasRestaurantFeature = useHasFeature('restaurant') || isSuperAdmin;
  const hasMaintenanceFeature = useHasFeature('maintenance') || isSuperAdmin;
  const hasPharmacyFeature = useHasFeature('pharmacy') || isSuperAdmin;
  const hasEnterpriseFeature = useHasFeature('accounting') || isContractingVertical || isMaritimeVertical || isManufacturingVertical || isSuperAdmin;
  const hasStorefrontFeature = useHasFeature('storefront') || isSuperAdmin;
  const hasInstallmentsFeature = useHasFeature('installments') || isSuperAdmin;
  const hasFixedAssetsFeature = useHasFeature('fixed_assets') || isContractingVertical || isMaritimeVertical || isManufacturingVertical || isSuperAdmin;
  const hasTaxDeclarationFeature = useHasFeature('vat_declaration') || isContractingVertical || isMaritimeVertical || isManufacturingVertical || isSuperAdmin;
  const hasDeliveryRepsFeature = useHasFeature('deliveryReps') || isSuperAdmin;
  const hasVanSalesFeature = useHasFeature('deliveryReps') || isWholesaleVanVertical || isSuperAdmin;
  const hasPurchasesFeature = useHasFeature('purchases') || isContractingVertical || isMaritimeVertical || isManufacturingVertical || isWarehousingVertical || isSuperAdmin;
  const hasInventoryFeature = useHasFeature('inventory') || isContractingVertical || isManufacturingVertical || isWarehousingVertical || isSuperAdmin;
  const hasHrFeature = useHasFeature('hr') || isContractingVertical || isMaritimeVertical || isManufacturingVertical || isSuperAdmin;
  const hasClothingFeature = useHasFeature('clothing') || isSuperAdmin;
  const hasMaritimeFreightFeature = useHasFeature('maritime_freight') || isMaritimeVertical || isSuperAdmin;
  const hasContractingFeature = useHasFeature('contracting') || isContractingVertical || isSuperAdmin;

  const hasServicesFeature = hasPurchasesFeature || hasInventoryFeature;
  const hasPosMetaFeature = hasRestaurantFeature;

  const isPosActive = isContractingVertical || isMaritimeVertical || isManufacturingVertical || isWholesaleVanVertical || isWarehousingVertical ? false : Boolean(form.watch('posModuleEnabled'));
  const isPurchasesActive = isContractingVertical || isMaritimeVertical || isManufacturingVertical ? true : (hasPurchasesFeature && Boolean(form.watch('purchasesModuleEnabled')));
  const isInventoryActive = isContractingVertical || isManufacturingVertical || isWarehousingVertical ? true : (isMaritimeVertical ? false : (hasInventoryFeature && Boolean(form.watch('inventoryModuleEnabled'))));
  const isHrActive = isContractingVertical || isMaritimeVertical || isManufacturingVertical ? true : (hasHrFeature && Boolean(form.watch('hrModuleEnabled')));
  const isManufacturingActive = isManufacturingVertical ? true : (hasManufacturingFeature && Boolean(form.watch('manufacturingModuleEnabled')));
  const isComboActive = hasPurchasesFeature && Boolean(form.watch('comboModuleEnabled'));
  const isImportActive = hasImportFeature && Boolean(form.watch('importModuleEnabled'));
  const isRestaurantActive = hasRestaurantFeature && Boolean(form.watch('restaurantModuleEnabled'));
  const isRestaurantVertical = rawActivity === 'restaurant' || rawActivity === 'cafe' || rawActivity === 'مطعم' || rawActivity === 'كافيه' || Boolean(isRestaurantActive);
  const isPhoneOrdersActive = Boolean(form.watch('phoneOrdersModuleEnabled'));
  const isPosMetaActive = hasPosMetaFeature && isRestaurantActive && Boolean(form.watch('posShowCartMeta'));
  const isMaintenanceActive = hasMaintenanceFeature && Boolean(form.watch('enableMobileStoreFeatures'));
  const enableMaintenance = isMaintenanceActive;
  const isPharmacyActive = hasPharmacyFeature && Boolean(form.watch('enablePharmacyModule'));
  const isServicesActive = hasServicesFeature && Boolean(form.watch('servicesModuleEnabled'));
  const isClothingActive = hasClothingFeature && Boolean(form.watch('clothingModuleEnabled'));
  const clothingModuleEnabled = isClothingActive;
  const isWeightedActive = Boolean(form.watch('weightedBarcodeEnabled'));
  const isEnterpriseActive = isContractingVertical || isMaritimeVertical || isManufacturingVertical ? true : (hasEnterpriseFeature && Boolean(form.watch('enableEnterpriseFeatures')));
  const isStorefrontActive = hasStorefrontFeature && Boolean(form.watch('storefrontModuleEnabled'));
  const isInstallmentsActive = hasInstallmentsFeature && Boolean(form.watch('installmentsModuleEnabled'));
  const isFixedAssetsActive = isContractingVertical || isMaritimeVertical || isManufacturingVertical ? true : (hasFixedAssetsFeature && Boolean(form.watch('fixedAssetsModuleEnabled')));
  const isTaxDeclarationActive = isContractingVertical || isMaritimeVertical || isManufacturingVertical ? true : (hasTaxDeclarationFeature && Boolean(form.watch('taxDeclarationModuleEnabled')));
  const isDeliveryRepsActive = hasDeliveryRepsFeature && Boolean(
    form.watch('deliveryRepsModuleEnabled') !== undefined
      ? form.watch('deliveryRepsModuleEnabled')
      : (!isWholesaleVanVertical && form.watch('deliveryFleetModuleEnabled'))
  );
  const isVanSalesActive = isWholesaleVanVertical
    ? true
    : (hasVanSalesFeature && Boolean(
        form.watch('vanSalesModuleEnabled') !== undefined
          ? form.watch('vanSalesModuleEnabled')
          : (isWholesaleVanVertical && form.watch('deliveryFleetModuleEnabled'))
      ));
  const isMaritimeFreightActive = isMaritimeVertical ? true : (hasMaritimeFreightFeature && Boolean(form.watch('maritimeFreightModuleEnabled')));
  const isContractingActive = isContractingVertical ? true : (hasContractingFeature && Boolean(form.watch('contractingModuleEnabled')));

  const currentProfileKey = form.watch('maintenanceProfile') || 'mobile';
  const currentProfile = getMaintenanceProfile(currentProfileKey);

  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [showManualSwitches, setShowManualSwitches] = useState(false);
  const [upgradeModalInfo, setUpgradeModalInfo] = useState<{
    open: boolean;
    title: string;
    planName: string;
    description: string;
  } | null>(null);

  const handleLockedCardClick = (title: string, planName: string, description: string) => {
    setUpgradeModalInfo({
      open: true,
      title,
      planName,
      description,
    });
  };

  const getCardStyle = (isActive: boolean, hasFeature: boolean) => ({
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: '14px 18px',
    background: !hasFeature ? '#f8fafc' : isActive ? '#f0fdf4' : '#ffffff',
    border: !hasFeature ? '1px dashed #cbd5e1' : isActive ? '1.5px solid #86efac' : '1px solid #e2e8f0',
    borderRadius: '10px',
    cursor: !hasFeature ? 'not-allowed' : 'pointer',
    transition: 'all 0.15s ease',
    boxShadow: isActive ? '0 2px 6px rgba(0,0,0,0.03)' : '0 1px 3px rgba(0,0,0,0.02)',
    gap: '12px',
    opacity: !hasFeature ? 0.7 : 1,
  });

  const getIconBadgeStyle = (isActive: boolean) => ({
    width: '38px',
    height: '38px',
    borderRadius: '8px',
    background: isActive ? '#dcfce7' : '#f8fafc',
    border: isActive ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    color: isActive ? '#15803d' : '#0f172a',
    flexShrink: 0,
    transition: 'all 0.15s ease',
  });

  return (
    <div style={{ display: activeTab === 'modules' ? 'block' : 'none' }}>
      {/* بطاقة نمط المنظومة وعزل الأنشطة (متاحة حصرياً للسوبر أدمن للتبديل الفوري بين المقاولات، الشحن، والتجارة) */}
      {isSuperAdmin && (
        <div style={{ marginBottom: '16px' }}>
          <IndustryModeSelectorCard settings={form.getValues() as any} canManageSettings={!disabled} />
        </div>
      )}

      {/* ===== باقة المقاولات الشاملة (All-Inclusive) ===== */}
      {isContractingVertical && (
        <ModulesSettingsContractingBanner />
      )}

      {/* ===== باقة الشحن واللوجستيات الشاملة (All-Inclusive) ===== */}
      {isMaritimeVertical && (
        <ModulesSettingsMaritimeBanner />
      )}

      {/* ===== باقة التصنيع والإنتاج الصناعي الشاملة (All-Inclusive) ===== */}
      {isManufacturingVertical && (
        <ModulesSettingsManufacturingBanner />
      )}

      {/* ===== نمط تشغيل المنشأة ونطاق العمل (محل تجاري مبسط مقابل مؤسسة متقدمة) ===== */}
      {/* INV-REST-SUCCESS-FEEDBACK-TRUTH: wholesale and warehousing force
          enableEnterpriseFeatures: true at every layer, so this choice is
          not a real choice for them — hidden here exactly as it already
          is for contracting/maritime/manufacturing. */}
      {!isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isWholesaleVanVertical && !isWarehousingVertical && (
        <ModulesSettingsOperationMode form={form} isSuperAdmin={isSuperAdmin} disabled={disabled} />
      )}

      {/* ===== متجر التطبيقات ومعالج الموديولات ===== */}
      <ModulesSettingsAppsStore isSuperAdmin={isSuperAdmin} />

      {/* ===== خيارات التفعيل اليدوي للموديولات (مخصصة حصرياً للسوبر أدمن) ===== */}
      {isSuperAdmin && (
        <div style={{ marginTop: '14px', marginBottom: '20px' }}>
          <button
            type="button"
            onClick={() => setShowManualSwitches((prev) => !prev)}
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '10px 16px',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: 700,
              color: '#475569',
              transition: 'all 0.15s ease',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{t('settings.forms.tabs.modules_settings_tab.s22', "خيارات التفعيل اليدوي المتقدمة للموديولات (خاص بالسوبر أدمن فقط)")}</span>
            </span>
            <span style={{ transform: showManualSwitches ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', display: 'flex' }}>
              <ChevronDownIcon size={18} />
            </span>
          </button>

        <div style={{ display: showManualSwitches ? 'block' : 'none', marginTop: '14px' }}>
          <FormSection title={t('settings.forms.tabs.modules_settings_tab.s23', "خيارات التفعيل اليدوي للموديولات")} description={<>{t('settings.forms.tabs.modules_settings_tab.s24', "شغّل الأجزاء التي تحتاجها لنشاطك يدوياً إذا رغبت، وسيتم ضبط وتحديث القوائم والشاشات تلقائياً.")}</>}>
        <div className="document-prototype-grid compact-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '14px' }}>
          
          <ModulesSettingsGridG1 isContractingVertical={isContractingVertical} isMaritimeVertical={isMaritimeVertical} getCardStyle={getCardStyle} getIconBadgeStyle={getIconBadgeStyle} form={form} disabled={disabled} isSuperAdmin={isSuperAdmin} hasInventoryFeature={hasInventoryFeature} handleLockedCardClick={handleLockedCardClick} hasPurchasesFeature={hasPurchasesFeature} hasHrFeature={hasHrFeature} hasManufacturingFeature={hasManufacturingFeature} isPosActive={isPosActive} isManufacturingVertical={isManufacturingVertical} isWholesaleVanVertical={isWholesaleVanVertical} isWarehousingVertical={isWarehousingVertical} isInventoryActive={isInventoryActive} isPurchasesActive={isPurchasesActive} isHrActive={isHrActive} isManufacturingActive={isManufacturingActive} isComboActive={isComboActive} isRestaurantVertical={isRestaurantVertical} />

          <ModulesSettingsGridG2 isContractingVertical={isContractingVertical} isMaritimeVertical={isMaritimeVertical} isSuperAdmin={isSuperAdmin} getCardStyle={getCardStyle} isImportActive={isImportActive} hasImportFeature={hasImportFeature} handleLockedCardClick={handleLockedCardClick} getIconBadgeStyle={getIconBadgeStyle} form={form} disabled={disabled} hasMaritimeFreightFeature={hasMaritimeFreightFeature} isMaritimeFreightActive={isMaritimeFreightActive} hasContractingFeature={hasContractingFeature} isContractingActive={isContractingActive} isRestaurantActive={isRestaurantActive} hasRestaurantFeature={hasRestaurantFeature} isPhoneOrdersActive={isPhoneOrdersActive} isPosMetaActive={isPosMetaActive} hasPosMetaFeature={hasPosMetaFeature} />

          <ModulesSettingsGridG3 isContractingVertical={isContractingVertical} isMaritimeVertical={isMaritimeVertical} isSuperAdmin={isSuperAdmin} getCardStyle={getCardStyle} isMaintenanceActive={isMaintenanceActive} hasMaintenanceFeature={hasMaintenanceFeature} handleLockedCardClick={handleLockedCardClick} getIconBadgeStyle={getIconBadgeStyle} form={form} setProfileModalOpen={setProfileModalOpen} disabled={disabled} isPharmacyActive={isPharmacyActive} hasPharmacyFeature={hasPharmacyFeature} isClothingActive={isClothingActive} hasClothingFeature={hasClothingFeature} isServicesActive={isServicesActive} hasServicesFeature={hasServicesFeature} isWeightedActive={isWeightedActive} isEnterpriseActive={isEnterpriseActive} hasEnterpriseFeature={hasEnterpriseFeature} isManufacturingVertical={isManufacturingVertical} isWholesaleVanVertical={isWholesaleVanVertical} isWarehousingVertical={isWarehousingVertical} />

          <ModulesSettingsGridG4 isContractingVertical={isContractingVertical} isMaritimeVertical={isMaritimeVertical} isSuperAdmin={isSuperAdmin} getCardStyle={getCardStyle} isStorefrontActive={isStorefrontActive} hasStorefrontFeature={hasStorefrontFeature} handleLockedCardClick={handleLockedCardClick} getIconBadgeStyle={getIconBadgeStyle} form={form} disabled={disabled} isInstallmentsActive={isInstallmentsActive} hasInstallmentsFeature={hasInstallmentsFeature} isFixedAssetsActive={isFixedAssetsActive} hasFixedAssetsFeature={hasFixedAssetsFeature} isTaxDeclarationActive={isTaxDeclarationActive} hasTaxDeclarationFeature={hasTaxDeclarationFeature} isDeliveryRepsActive={isDeliveryRepsActive} hasDeliveryRepsFeature={hasDeliveryRepsFeature} isVanSalesActive={isVanSalesActive} hasVanSalesFeature={hasVanSalesFeature} isWholesaleVanVertical={isWholesaleVanVertical} />
        </div>

        {enableMaintenance && ((!isContractingVertical && !isMaritimeVertical) || isSuperAdmin) ? (
          <ModulesSettingsMaintenanceProfile currentProfile={currentProfile} setProfileModalOpen={setProfileModalOpen} disabled={disabled} form={form} />
        ) : null}

        {/* Modal Dialog for Selecting Maintenance Profile */}
        <DialogShell
          open={profileModalOpen}
          onClose={() => setProfileModalOpen(false)}
          width="min(960px, 96vw)"
          ariaLabel={t('settings.forms.tabs.modules_settings_tab.s168', "تخصيص نوع نشاط الصيانة والأجهزة")}
        >
          <div style={{ padding: '14px 10px 18px' }}>
            <style>{`
              .maintenance-profile-card {
                transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.22s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.22s ease !important;
                will-change: transform, box-shadow;
              }
              .maintenance-profile-card:hover {
                transform: translateY(-3px) !important;
                box-shadow: 0 10px 24px -4px rgba(37, 99, 235, 0.14), 0 3px 8px -2px rgba(0, 0, 0, 0.05) !important;
                border-color: #93c5fd !important;
              }
            `}</style>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', borderBottom: '1px solid #e2e8f0', paddingBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563eb', boxShadow: '0 2px 8px rgba(37, 99, 235, 0.12)', flexShrink: 0 }}>
                  <MaintenanceWrenchIcon size={24} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '1.18rem', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.01em' }}>
                      {t('settings.forms.tabs.modules_settings_tab.s169', "تخصيص نوع نشاط الصيانة والأجهزة")}
                    </h3>
                    <span style={{ fontSize: '0.72rem', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', padding: '2px 8px', borderRadius: '12px', fontWeight: 800 }}>
                      {t('settings.forms.tabs.modules_settings_tab.s170', "9 أنشطة ذكية")}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.84rem', color: '#64748b', fontWeight: 500, lineHeight: 1.4 }}>
                    {t('settings.forms.tabs.modules_settings_tab.s171', "اختر النشاط التجاري لتكييف حقول الفحص، المسميات، وإيصالات الاستلام فوراً")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', width: 34, height: 34, cursor: 'pointer', fontWeight: 800, color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s ease', flexShrink: 0 }}
              >
                <XIcon size={16} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', maxHeight: '58vh', overflowY: 'auto', padding: '4px 2px' }}>
              {(Object.keys(MAINTENANCE_PROFILES) as MaintenanceProfileKey[]).map((key) => {
                const profile = MAINTENANCE_PROFILES[key];
                const isSelected = currentProfileKey === key;
                return (
                  <div
                    key={key}
                    className="maintenance-profile-card"
                    onClick={() => {
                      form.setValue('maintenanceProfile', key, { shouldDirty: true });
                      form.setValue('enableMobileStoreFeatures', true, { shouldDirty: true });
                      setProfileModalOpen(false);
                    }}
                    style={{
                      border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                      background: isSelected ? 'linear-gradient(145deg, #f0f7ff 0%, #ffffff 100%)' : '#ffffff',
                      borderRadius: '12px',
                      padding: '16px',
                      cursor: 'pointer',
                      boxShadow: isSelected ? '0 6px 20px rgba(37, 99, 235, 0.14)' : '0 1px 3px rgba(0,0,0,0.03)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '10px',
                      position: 'relative'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: 38,
                            height: 38,
                            borderRadius: 10,
                            background: isSelected ? '#dbeafe' : '#f8fafc',
                            border: `1.5px solid ${isSelected ? '#93c5fd' : '#e2e8f0'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: isSelected ? '#1d4ed8' : '#334155',
                            boxShadow: isSelected ? '0 2px 6px rgba(29, 78, 216, 0.15)' : 'none',
                            flexShrink: 0
                          }}>
                            <ProfileVectorIcon type={profile.iconType} size={20} />
                          </div>
                          <div>
                            <strong style={{ fontSize: '0.9rem', color: isSelected ? '#1e40af' : '#0f172a', fontWeight: 800, display: 'block', lineHeight: 1.3 }}>
                              {profile.title}
                            </strong>
                          </div>
                        </div>
                        {isSelected && (
                          <span style={{
                            background: '#2563eb',
                            color: '#ffffff',
                            borderRadius: '50%',
                            width: 22,
                            height: 22,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 2px 6px rgba(37, 99, 235, 0.4)',
                            flexShrink: 0
                          }}>
                            <CheckIcon size={12} color="#ffffff" />
                          </span>
                        )}
                      </div>

                      <p style={{ fontSize: '0.78rem', color: isSelected ? '#1e3a8a' : '#64748b', lineHeight: 1.45, margin: '0 0 8px', opacity: isSelected ? 0.9 : 1 }}>
                        {profile.subtitle}
                      </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px dashed ${isSelected ? '#bfdbfe' : '#f1f5f9'}`, paddingTop: '8px', flexWrap: 'wrap', gap: '6px' }}>
                      <span style={{
                        fontSize: '0.72rem',
                        background: isSelected ? '#dbeafe' : '#f1f5f9',
                        color: isSelected ? '#1e40af' : '#475569',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontWeight: 700
                      }}>
                        {profile.serialLabel}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>
                        {profile.sampleBrands.slice(0, 2).join(' • ')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: '14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: '#475569' }}>
              <LightbulbIcon size={16} color="#2563eb" />
              <span>{t('settings.forms.tabs.modules_settings_tab.s172', "يمكنك التبديل بين أنشطة الصيانة في أي وقت لتكييف الواجهات بما يلائم عملك دون التأثير على التذاكر والسجلات السابقة.")}</span>
            </div>
          </div>
        </DialogShell>

        {clothingModuleEnabled && ((!isContractingVertical && !isMaritimeVertical) || isSuperAdmin) ? (
          <div className="document-prototype-grid compact-grid-2" style={{ marginTop: 16 }}>
            <div className="field">
              <label>{t('settings.forms.tabs.modules_settings_tab.s173', "النمط الافتراضي عند إضافة صنف")}</label>
              <select className="purchase-prototype-field-input" {...form.register('defaultProductKind')} disabled={disabled}>
                <option value="standard">{t('settings.forms.tabs.modules_settings_tab.s174', "صنف عادي (بسيط بدون متغيرات)")}</option>
                <option value="fashion">{t('settings.forms.tabs.modules_settings_tab.s175', "صنف بمتغيرات (أحجام / روائح / مقاسات)")}</option>
              </select>
            </div>
          </div>
        ) : null}

      </FormSection>
        </div>
      </div>
      )}

      {/* مودال ترقية الباقة عند محاولة الوصول لموديول مقفول */}
      <DialogShell
        open={Boolean(upgradeModalInfo?.open)}
        onClose={() => setUpgradeModalInfo(null)}
        width="min(540px, 94vw)"
        ariaLabel={t('settings.forms.tabs.modules_settings_tab.s183', "ترقية الباقة لتفعيل الموديول")}
      >
        <div style={{ padding: '24px 20px', textAlign: 'center' }}>
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: '#eff6ff',
            color: '#1d4ed8',
            border: '2px solid #bfdbfe',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            fontSize: '24px',
            boxShadow: '0 4px 12px rgba(29, 78, 216, 0.12)'
          }}>
            <LockIcon size={22} />
          </div>

          <h3 style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0f172a', margin: '0 0 8px' }}>
            {t('settings.forms.tabs.modules_settings_tab.s184', "موديول")} {upgradeModalInfo?.title}
          </h3>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#dbeafe', color: '#1e40af', padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 800, marginBottom: '14px' }}>
            <StarIcon size={14} color="#1e40af" />
            <span>{t('settings.forms.tabs.modules_settings_tab.s185', "متاح حصرياً في")} {upgradeModalInfo?.planName}</span>
          </div>

          <p style={{ fontSize: '0.86rem', color: '#475569', lineHeight: 1.6, margin: '0 0 24px', textAlign: 'center' }}>
            {upgradeModalInfo?.description}
          </p>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center' }}>
            {!isDesktopOfflineApp() && (
            <Link to="/settings/subscription" style={{ textDecoration: 'none' }}>
              <button
                type="button"
                style={{
                  background: '#170e5e',
                  color: '#ffffff',
                  padding: '10px 24px',
                  fontSize: '0.88rem',
                  fontWeight: 800,
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(23, 14, 94, 0.25)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <StarIcon size={14} color="#ffffff" />
                <span>{t('settings.forms.tabs.modules_settings_tab.s186', "ترقية الباقة الآن")}</span>
              </button>
            </Link>
            )}
            <button
              type="button"
              onClick={() => setUpgradeModalInfo(null)}
              style={{
                background: '#f1f5f9',
                color: '#334155',
                padding: '10px 20px',
                fontSize: '0.88rem',
                fontWeight: 700,
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                cursor: 'pointer'
              }}
            >
              {t('settings.forms.tabs.modules_settings_tab.s187', "إغلاق")}
            </button>
          </div>
        </div>
      </DialogShell>
    </div>
  );
}, (prev, next) => {
  if (prev.activeTab !== 'modules' && next.activeTab !== 'modules') {
    return true;
  }
  return false;
});
