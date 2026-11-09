import { useTranslation } from 'react-i18next';
import { useState, memo } from 'react';
import { Link } from 'react-router-dom';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import { FormSection } from '@/shared/components/form-section';
import { LightbulbIcon, XIcon, CheckIcon, StarIcon, ChevronDownIcon, MonitorIcon, PackageIcon, ReceiptIcon, UsersIcon, PhoneCallIcon, TruckIcon } from '@/shared/components/icons/AppIcons';
import { useHasFeature } from '@/shared/hooks/use-permission';
import { useAuthStore } from '@/stores/auth-store';
import { isPlatformAdmin, isDesktopOfflineApp } from '@/app/router/access';
import { DialogShell } from '@/shared/components/dialog-shell';
import { MAINTENANCE_PROFILES, getMaintenanceProfile, type MaintenanceProfileKey } from '@/features/maintenance/constants/maintenance-profiles';
import { IndustryModeSelectorCard } from '@/features/settings/components/workspace-sections/IndustryModeSelectorCard';

interface ModulesTabProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  activeTab: string;
}

// Premium SVG Line Icons
function FactoryIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M17 18h1" />
      <path d="M12 18h1" />
      <path d="M7 18h1" />
    </svg>
  );
}

function ComboPackageIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function CargoShipIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.5 0 2.5 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.26.94 4.3 2.45 5.82" />
      <path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4" />
      <path d="M12 2v4" />
    </svg>
  );
}

function ContractingBuildingIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 9h6M9 13h6M9 17h6" />
    </svg>
  );
}

function UtensilsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 2v6a3 3 0 0 1-3 3 3 3 0 0 1-3-3V2" />
      <path d="M15 2v18" />
      <path d="M5 2v8a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3V2" />
      <path d="M8 2v18" />
    </svg>
  );
}

function PharmacyCrossIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      <path d="M12 5v6" />
      <path d="M9 8h6" />
    </svg>
  );
}

function TableCustomerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function VariantsLayersIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </svg>
  );
}

function ScaleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="M7 21h10" />
      <path d="M12 3v18" />
      <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </svg>
  );
}

function WrenchServiceIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function EnterpriseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01" />
      <path d="M16 6h.01" />
      <path d="M12 6h.01" />
      <path d="M12 10h.01" />
      <path d="M12 14h.01" />
      <path d="M16 10h.01" />
      <path d="M16 14h.01" />
      <path d="M8 10h.01" />
      <path d="M8 14h.01" />
    </svg>
  );
}

function MaintenanceWrenchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function ProfileVectorIcon({ type, size = 20 }: { type: string; size?: number }) {
  if (type === 'mobile') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
        <path d="M12 18h.01" />
      </svg>
    );
  }
  if (type === 'computer') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="12" x="3" y="4" rx="2" />
        <line x1="2" x2="22" y1="20" y2="20" />
      </svg>
    );
  }
  if (type === 'console') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" x2="10" y1="12" y2="12" />
        <line x1="8" x2="8" y1="10" y2="14" />
        <line x1="15" x2="15.01" y1="13" y2="13" />
        <line x1="18" x2="18.01" y1="11" y2="11" />
        <rect width="20" height="12" x="2" y="6" rx="6" />
      </svg>
    );
  }
  if (type === 'printer') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect width="12" height="8" x="6" y="14" />
      </svg>
    );
  }
  if (type === 'screens') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect width="20" height="15" x="2" y="3" rx="2" />
        <polyline points="17 21 12 18 7 21" />
      </svg>
    );
  }
  if (type === 'appliances') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
        <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
        <line x1="6" x2="6" y1="2" y2="4" />
        <line x1="10" x2="10" y1="2" y2="4" />
        <line x1="14" x2="14" y1="2" y2="4" />
      </svg>
    );
  }
  if (type === 'cooling') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" x2="12" y1="2" y2="22" />
        <line x1="2" x2="22" y1="12" y2="12" />
        <line x1="20" x2="4" y1="16" y2="8" />
        <line x1="20" x2="4" y1="8" y2="16" />
      </svg>
    );
  }
  if (type === 'scooters') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="18" r="3" />
        <path d="M6 18h12" />
        <path d="M18 15V5h-3" />
      </svg>
    );
  }
  return <MaintenanceWrenchIcon size={size} />;
}

function LockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', marginInlineEnd: '3px' }}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function OnlineStorefrontIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
      <path d="m9 9 3 3 6-6" />
    </svg>
  );
}

function InstallmentsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
      <path d="m8 14 2 2 4-4" />
    </svg>
  );
}

function FixedAssetsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 10a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v11H9Z" />
    </svg>
  );
}

function TaxDeclarationIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  );
}

function DeliveryFleetIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-5l-3-4h-5v10h1" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  );
}

const premiumCardTextStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '3px',
};

const premiumCheckboxInputStyle = {
  width: '18px',
  height: '18px',
  accentColor: '#0f172a',
  cursor: 'pointer',
  flexShrink: 0,
};

export const ModulesSettingsTab = memo(function ModulesSettingsTab({ form, disabled, activeTab }: ModulesTabProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const isSuperAdmin = isPlatformAdmin(user) || (user?.role === 'super_admin' && String(user?.username || '').trim().toLowerCase() === 'zs');

  const rawActivity = String(tenant?.activityType || tenant?.pillar || form.watch('businessIndustry') || form.watch('activityType') || 'retail_general').trim().toLowerCase();
  const isContractingVertical = rawActivity === 'contracting' || rawActivity === 'construction' || rawActivity === 'مقاولات';
  const isMaritimeVertical = rawActivity === 'maritime_freight' || rawActivity === 'maritime' || rawActivity === 'freight' || rawActivity === 'shipping' || rawActivity === 'شحن';
  const isManufacturingVertical = rawActivity === 'manufacturing' || rawActivity === 'production' || rawActivity === 'تصنيع' || rawActivity === 'مصنع';
  const isWholesaleVanVertical = rawActivity === 'wholesale_van' || rawActivity === 'wholesale' || rawActivity === 'distribution' || rawActivity.includes('توزيع') || rawActivity.includes('فان') || rawActivity.includes('جمل');
  const isWarehousingVertical = rawActivity === 'warehousing' || rawActivity === 'warehouse' || rawActivity === 'wms' || rawActivity.includes('مخازن') || rawActivity.includes('مستودع');
  const isImportVertical = rawActivity === 'import_export' || rawActivity === 'import' || rawActivity.includes('استيراد');
  const isCommerceVertical = !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isWholesaleVanVertical && !isWarehousingVertical;

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
  const hasPurchasesFeature = useHasFeature('purchases') || isContractingVertical || isMaritimeVertical || isManufacturingVertical || isCommerceVertical || isWarehousingVertical || isSuperAdmin;
  const hasInventoryFeature = useHasFeature('inventory') || isContractingVertical || isManufacturingVertical || isCommerceVertical || isWarehousingVertical || isSuperAdmin;
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
  const weightedBarcodeEnabled = isWeightedActive;
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
        <div style={{
          padding: '12px 16px',
          marginBottom: '14px',
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.82rem',
          color: '#166534',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: '#16a34a', display: 'flex', alignItems: 'center' }}>
              <ContractingBuildingIcon size={20} />
            </span>
            <span>
              <strong>{t('settings.forms.tabs.modules_settings_tab.s0', "باقة المقاولات الشاملة (All-Inclusive Suite):")}</strong> {t('settings.forms.tabs.modules_settings_tab.s1', "تم تفعيل كافة الموديولات التشغيلية للمقاولات تلقائياً (المشاريع والمقايسات، مشتريات ومقاولو الباطن، مستودعات المواقع، مراكز التكلفة والمحاسبة، والموارد البشرية) بكامل صلاحيات المنظومة دون قيود باقات.")}
            </span>
          </div>
          <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#15803d', padding: '3px 10px', borderRadius: '6px', fontWeight: 800, border: '1px solid #86efac', flexShrink: 0 }}>
            {t('settings.forms.tabs.modules_settings_tab.s2', "باقة متكاملة شاملة")}
          </span>
        </div>
      )}

      {/* ===== باقة الشحن واللوجستيات الشاملة (All-Inclusive) ===== */}
      {isMaritimeVertical && (
        <div style={{
          padding: '12px 16px',
          marginBottom: '14px',
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.82rem',
          color: '#166534',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: '#16a34a', display: 'flex', alignItems: 'center' }}>
              <CargoShipIcon size={20} />
            </span>
            <span>
              <strong>{t('settings.forms.tabs.modules_settings_tab.s3', "باقة الشحن واللوجستيات الشاملة (All-Inclusive Suite):")}</strong> {t('settings.forms.tabs.modules_settings_tab.s4', "تم تفعيل كافة الموديولات التشغيلية للشحن تلقائياً (أوامر تشغيل الشحنات، تتبع الحاويات، الخطوط الملاحية والموردين، عروض الأسعار والعملاء، محاسبة الشحن، والموارد البشرية) بكامل صلاحيات المنظومة دون قيود باقات.")}
            </span>
          </div>
          <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#15803d', padding: '3px 10px', borderRadius: '6px', fontWeight: 800, border: '1px solid #86efac', flexShrink: 0 }}>
            {t('settings.forms.tabs.modules_settings_tab.s5', "باقة متكاملة شاملة")}
          </span>
        </div>
      )}

      {/* ===== باقة التصنيع والإنتاج الصناعي الشاملة (All-Inclusive) ===== */}
      {isManufacturingVertical && (
        <div style={{
          padding: '12px 16px',
          marginBottom: '14px',
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.82rem',
          color: '#166534',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: '#16a34a', display: 'flex', alignItems: 'center' }}>
              <FactoryIcon size={20} />
            </span>
            <span>
              <strong>{t('settings.forms.tabs.modules_settings_tab.s6', "باقة التصنيع والإنتاج الصناعي الشاملة (All-Inclusive Suite):")}</strong> {t('settings.forms.tabs.modules_settings_tab.s7', "تم تفعيل كافة الموديولات التشغيلية للمصانع تلقائياً (أوامر الإنتاج، قوائم المكونات BOM، مشتريات المواد الخام والتوريد، مستودعات المواد والمنتج التام، مراكز التكلفة والمحاسبة، CRM، والموارد البشرية) بكامل صلاحيات المنظومة دون قيود باقات.")}
            </span>
          </div>
          <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#15803d', padding: '3px 10px', borderRadius: '6px', fontWeight: 800, border: '1px solid #86efac', flexShrink: 0 }}>
            {t('settings.forms.tabs.modules_settings_tab.s8', "باقة متكاملة شاملة")}
          </span>
        </div>
      )}

      {/* ===== نمط تشغيل المنشأة ونطاق العمل (محل تجاري مبسط مقابل مؤسسة متقدمة) ===== */}
      {/* INV-REST-SUCCESS-FEEDBACK-TRUTH: wholesale and warehousing force
          enableEnterpriseFeatures: true at every layer, so this choice is
          not a real choice for them — hidden here exactly as it already
          is for contracting/maritime/manufacturing. */}
      {!isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isWholesaleVanVertical && !isWarehousingVertical && (
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '18px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <strong style={{ fontSize: '0.95rem', color: '#0f172a', fontWeight: 800, display: 'block' }}>
                {t('settings.forms.tabs.modules_settings_tab.s9', "نمط تشغيل المنشأة ونطاق العمل (Operation Mode)")}
              </strong>
              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                {t('settings.forms.tabs.modules_settings_tab.s10', "اختر النمط المناسب لحجم نشاطك لضبط القوائم والواجهات؛ يتم تدوين القيود المحاسبية في الخلفية تلقائياً في كلا النمطين.")}
              </span>
            </div>
            <span style={{
              fontSize: '0.72rem',
              fontWeight: 800,
              background: form.watch('enableEnterpriseFeatures') ? '#eff6ff' : '#f0fdf4',
              color: form.watch('enableEnterpriseFeatures') ? '#1d4ed8' : '#166534',
              border: `1px solid ${form.watch('enableEnterpriseFeatures') ? '#bfdbfe' : '#bbf7d0'}`,
              padding: '3px 10px',
              borderRadius: '6px',
            }}>
              {form.watch('enableEnterpriseFeatures') ? t('settings.forms.tabs.modules_settings_tab.s11', "النمط المؤسسي المتقدم") : t('settings.forms.tabs.modules_settings_tab.s12', "النمط التجاري المبسط")}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
            {/* Option 1: Simple Retail Mode */}
            <div
              onClick={() => {
                if (disabled) return;
                form.setValue('enableEnterpriseFeatures', false, { shouldDirty: true, shouldValidate: true });
              }}
              style={{
                border: !form.watch('enableEnterpriseFeatures') ? '2px solid #170e5e' : '1px solid #e2e8f0',
                background: !form.watch('enableEnterpriseFeatures') ? '#f8fafc' : '#ffffff',
                borderRadius: '10px',
                padding: '14px 16px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    border: !form.watch('enableEnterpriseFeatures') ? '5px solid #170e5e' : '2px solid #cbd5e1',
                    boxSizing: 'border-box',
                    display: 'inline-block',
                    flexShrink: 0,
                  }} />
                  <strong style={{ fontSize: '0.9rem', color: '#0f172a', fontWeight: 800 }}>
                    {t('settings.forms.tabs.modules_settings_tab.s13', "محل تجاري ونقاط بيع مبسطة (Simple Retail)")}
                  </strong>
                </div>
                <span style={{ fontSize: '0.7rem', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('settings.forms.tabs.modules_settings_tab.s14', "موصى به للمحلات")}
                </span>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                {t('settings.forms.tabs.modules_settings_tab.s15', "واجهة رشيقة وسريعة للكاشير ونقاط البيع والفواتير المباشرة والمخزون، مع الخزينة والمصروفات اليومية. تخفي الشيكات والبنوك وقيود اليومية وأوامر الشراء والأرفف لمنع التشتيت وسرعة الإنجاز.")}
              </p>
            </div>

            {/* Option 2: Enterprise Trading Mode */}
            <div
              onClick={() => {
                if (disabled) return;
                form.setValue('enableEnterpriseFeatures', true, { shouldDirty: true, shouldValidate: true });
              }}
              style={{
                border: form.watch('enableEnterpriseFeatures') ? '2px solid #170e5e' : '1px solid #e2e8f0',
                background: form.watch('enableEnterpriseFeatures') ? '#f8fafc' : '#ffffff',
                borderRadius: '10px',
                padding: '14px 16px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    border: form.watch('enableEnterpriseFeatures') ? '5px solid #170e5e' : '2px solid #cbd5e1',
                    boxSizing: 'border-box',
                    display: 'inline-block',
                    flexShrink: 0,
                  }} />
                  <strong style={{ fontSize: '0.9rem', color: '#0f172a', fontWeight: 800 }}>
                    {t('settings.forms.tabs.modules_settings_tab.s16', "مؤسسة تجارية متقدمة (Enterprise Trading)")}
                  </strong>
                </div>
                <span style={{ fontSize: '0.7rem', background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('settings.forms.tabs.modules_settings_tab.s17', "محاسبة متقدمة")}
                </span>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                {t('settings.forms.tabs.modules_settings_tab.s18', "تفعيل الدورة المستندية الكاملة: أوامر الشراء والبيع، عروض الأسعار (RFQ)، شجرة المخازن والأرفف، المحاسبة العامة، شجرة الحسابات، قيود اليومية، حافظة الشيكات (PDC)، والتسويات البنكية ومراكز التكلفة.")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ===== متجر التطبيقات ومعالج الموديولات ===== */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        padding: '16px 20px',
        borderRadius: '12px',
        marginBottom: isSuperAdmin ? '18px' : '0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        <div>
          <strong style={{ fontSize: '0.92rem', color: '#0f172a', display: 'block', marginBottom: '3px', fontWeight: 800 }}>
            {t('settings.forms.tabs.modules_settings_tab.s19', "متجر التطبيقات والموديولات (Apps Store)")}
          </strong>
          <span style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: 1.5 }}>
            {t('settings.forms.tabs.modules_settings_tab.s20', "الواجهة المعتمدة لاستعراض موديولات وتطبيقات النظام وتفاصيلها التشغيلية وفق باقة الاشتراك المعتمدة ونشاط المنشأة.")}
          </span>
        </div>
        <Link
          to="/apps"
          style={{
            padding: '8px 18px',
            background: '#170e5e',
            color: '#ffffff',
            borderRadius: '8px',
            fontSize: '0.82rem',
            fontWeight: 700,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          {t('settings.forms.tabs.modules_settings_tab.s21', "فتح متجر التطبيقات")}
        </Link>
      </div>

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
          
          {/* نقاط البيع السريعة والكاشير */}
          {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
            <label style={getCardStyle(Boolean(isPosActive), !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isWholesaleVanVertical && !isWarehousingVertical)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={getIconBadgeStyle(Boolean(isPosActive))}>
                  <MonitorIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s25', "نقاط البيع السريعة والكاشير (POS)")}</strong>
                    {isContractingVertical ? (
                      <span style={{ fontSize: '0.7rem', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                        {t('settings.forms.tabs.modules_settings_tab.s26', "معطل تلقائياً (غير مخصص للمقاولات)")}
                      </span>
                    ) : isMaritimeVertical ? (
                      <span style={{ fontSize: '0.7rem', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                        {t('settings.forms.tabs.modules_settings_tab.s27', "معطل تلقائياً (غير مخصص للشحن)")}
                      </span>
                    ) : isWarehousingVertical ? (
                      <span style={{ fontSize: '0.7rem', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                        {t('settings.forms.tabs.modules_settings_tab.s188', "معطل تلقائياً (غير مخصص للمخازن)")}
                      </span>
                    ) : isWholesaleVanVertical ? (
                      <span style={{ fontSize: '0.7rem', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                        {t('settings.forms.tabs.modules_settings_tab.s189', "معطل تلقائياً (غير مخصص للجملة والتوزيع)")}
                      </span>
                    ) : isManufacturingVertical ? (
                      <span style={{ fontSize: '0.7rem', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                        {t('settings.forms.tabs.modules_settings_tab.s190', "معطل تلقائياً (غير مخصص للتصنيع)")}
                      </span>
                    ) : null}
                  </div>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s28', "شاشات البيع السريع بالباركود والورديات (يمكن إيقافها لشركات الجملة والخدمات والمشاريع)")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posModuleEnabled')} checked={Boolean(isPosActive)} disabled={disabled || isContractingVertical || isMaritimeVertical || isManufacturingVertical || isWholesaleVanVertical || isWarehousingVertical} />
            </label>
          ) : null}

          {/* المخازن والمستودعات المتقدمة */}
          {!isMaritimeVertical || isSuperAdmin ? (
            <label 
              style={getCardStyle(Boolean(isInventoryActive), hasInventoryFeature || isContractingVertical)}
              onClick={(e) => {
                if (isContractingVertical || isMaritimeVertical) return;
                if (!hasInventoryFeature) {
                  e.preventDefault();
                  handleLockedCardClick(
                    t('settings.forms.tabs.modules_settings_tab.s29', "المخازن والمستودعات المتقدمة"),
                    t('settings.forms.tabs.modules_settings_tab.s30', "باقة النمو (الاحترافية)"),
                    t('settings.forms.tabs.modules_settings_tab.s31', "يتيح لك هذا الموديول إدارة المستودعات المتعددة، التحويلات المخزنية، أذون الإضافة والصرف، ومحاضر الجرد الدوري.")
                  );
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={getIconBadgeStyle(Boolean(isInventoryActive))}>
                  <PackageIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s32', "المخازن والمستودعات المتقدمة")}</strong>
                    {isContractingVertical ? (
                      <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                        {t('settings.forms.tabs.modules_settings_tab.s33', "مفعل تلقائياً لمستودعات ومخازن المواقع")}
                      </span>
                    ) : isMaritimeVertical ? (
                      <span style={{ fontSize: '0.7rem', background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                        {t('settings.forms.tabs.modules_settings_tab.s34', "غير مخصص للشحن (يعتمد على الحاويات)")}
                      </span>
                    ) : !hasInventoryFeature ? (
                      <span style={{ fontSize: '0.7rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                        <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s35', "باقة النمو")}
                      </span>
                    ) : null}
                  </div>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s36', "التحويلات بين المخازن، أذون الصرف، والجرد (يمكن إيقافه للأنشطة الخدمية)")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('inventoryModuleEnabled')} checked={Boolean(isInventoryActive)} disabled={disabled || isContractingVertical || isMaritimeVertical || !hasInventoryFeature} />
            </label>
          ) : null}

          {/* المشتريات وإدارة الموردين */}
          <label 
            style={getCardStyle(Boolean(isPurchasesActive), hasPurchasesFeature || isContractingVertical || isMaritimeVertical)}
            onClick={(e) => {
              if (isContractingVertical || isMaritimeVertical) return;
              if (!hasPurchasesFeature) {
                e.preventDefault();
                handleLockedCardClick(
                  t('settings.forms.tabs.modules_settings_tab.s37', "المشتريات وإدارة الموردين"),
                  t('settings.forms.tabs.modules_settings_tab.s38', "باقة النمو (الاحترافية)"),
                  t('settings.forms.tabs.modules_settings_tab.s39', "يتيح لك هذا الموديول إصدار أوامر وفواتير الشراء، إدارة حسابات ومستحقات الموردين، ومتابعة سندات الصرف.")
                );
              }
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={getIconBadgeStyle(Boolean(isPurchasesActive))}>
                <ReceiptIcon size={20} />
              </div>
              <div style={premiumCardTextStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s40', "المشتريات وإدارة الموردين")}</strong>
                  {isContractingVertical ? (
                    <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      {t('settings.forms.tabs.modules_settings_tab.s41', "مفعل تلقائياً لمشتريات ومقاولي الباطن")}
                    </span>
                  ) : isMaritimeVertical ? (
                    <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      {t('settings.forms.tabs.modules_settings_tab.s42', "مفعل تلقائياً للخطوط الملاحية ومصاريف الشحن")}
                    </span>
                  ) : !hasPurchasesFeature ? (
                    <span style={{ fontSize: '0.7rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                      <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s43', "باقة النمو")}
                    </span>
                  ) : null}
                </div>
                <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s44', "فواتير الشراء، مرتجعات المشتريات، وحسابات الموردين وسندات الصرف")}</small>
              </div>
            </div>
            <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('purchasesModuleEnabled')} checked={Boolean(isPurchasesActive)} disabled={disabled || isContractingVertical || isMaritimeVertical || !hasPurchasesFeature} />
          </label>

          {/* الموارد البشرية والرواتب */}
          <label 
            style={getCardStyle(Boolean(isHrActive), hasHrFeature || isContractingVertical || isMaritimeVertical)}
            onClick={(e) => {
              if (isContractingVertical || isMaritimeVertical) return;
              if (!hasHrFeature) {
                e.preventDefault();
                handleLockedCardClick(
                  t('settings.forms.tabs.modules_settings_tab.s45', "الموارد البشرية والرواتب (HR)"),
                  t('settings.forms.tabs.modules_settings_tab.s46', "الباقة المتكاملة (Ultimate ERP)"),
                  t('settings.forms.tabs.modules_settings_tab.s47', "يتيح لك هذا الموديول إدارة شؤون الموظفين، مسير الرواتب الآلي، تسجيل الحضور والانصراف، السلف، ونهاية الخدمة.")
                );
              }
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={getIconBadgeStyle(Boolean(isHrActive))}>
                <UsersIcon size={20} />
              </div>
              <div style={premiumCardTextStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s48', "الموارد البشرية والرواتب (HR)")}</strong>
                  {isContractingVertical ? (
                    <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      {t('settings.forms.tabs.modules_settings_tab.s49', "مفعل تلقائياً لعمالة ومهندسي المشاريع")}
                    </span>
                  ) : isMaritimeVertical ? (
                    <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      {t('settings.forms.tabs.modules_settings_tab.s50', "مفعل تلقائياً لموظفي وعمليات الشحن")}
                    </span>
                  ) : !hasHrFeature ? (
                    <span style={{ fontSize: '0.7rem', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                      <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s51', "الباقة المتكاملة")}
                    </span>
                  ) : null}
                </div>
                <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s52', "مسير الرواتب، تسجيل الحضور، السلف، وملفات الموظفين (يمكن إيقافه للمتاجر الفردية)")}</small>
              </div>
            </div>
            <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('hrModuleEnabled')} checked={Boolean(isHrActive)} disabled={disabled || isContractingVertical || isMaritimeVertical || !hasHrFeature} />
          </label>

          {/* التصنيع والإنتاج */}
          {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
            <label 
              style={getCardStyle(Boolean(isManufacturingActive), hasManufacturingFeature)}
              onClick={(e) => {
                if (!hasManufacturingFeature) {
                  e.preventDefault();
                  handleLockedCardClick(
                    t('settings.forms.tabs.modules_settings_tab.s53', "التصنيع والإنتاج"),
                    t('settings.forms.tabs.modules_settings_tab.s54', "الباقة المتكاملة (Ultimate ERP)"),
                    t('settings.forms.tabs.modules_settings_tab.s55', "يتيح لك هذا الموديول تعريف شجرة وقوائم المكونات (BOM)، أوامر الإنتاج، ومراكز العمل وحساب التكاليف.")
                  );
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={getIconBadgeStyle(Boolean(isManufacturingActive))}>
                  <FactoryIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s56', "التصنيع والإنتاج")}</strong>
                    {!hasManufacturingFeature && (
                      <span style={{ fontSize: '0.7rem', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                        <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s57', "الباقة المتكاملة")}
                      </span>
                    )}
                  </div>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s58', "يضيف خيارات المكونات، وصفات الإنتاج، وأوامر التصنيع")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('manufacturingModuleEnabled')} checked={Boolean(isManufacturingActive)} disabled={disabled || !hasManufacturingFeature} />
            </label>
          ) : null}

          {/* العروض المجمعة والوجبات */}
          {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
            <label style={getCardStyle(Boolean(isComboActive), true)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={getIconBadgeStyle(Boolean(isComboActive))}>
                  <ComboPackageIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {isRestaurantVertical
                      ? t('settings.forms.tabs.modules_settings_tab.s59_restaurant', "العروض المجمعة والوجبات (Combo)")
                      : t('settings.forms.tabs.modules_settings_tab.s59', "الأطقم والعروض المجمعة (Bundles)")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {isRestaurantVertical
                      ? t('settings.forms.tabs.modules_settings_tab.s60_restaurant', "يفعّل وجبات وعروض المطاعم المكوّنة من عدة أصناف (Combo)")
                      : t('settings.forms.tabs.modules_settings_tab.s60', "يفعّل باقات وأطقم الملابس والتجزئة المكوّنة من عدة أصناف (Bundles)")}
                  </small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('comboModuleEnabled')} checked={Boolean(isComboActive)} disabled={disabled} />
            </label>
          ) : null}

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
          {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
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
          ) : null}

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
        </div>

        {enableMaintenance && ((!isContractingVertical && !isMaritimeVertical) || isSuperAdmin) ? (
          <div style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', marginTop: 18, boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: '10px',
                  background: '#eff6ff',
                  border: '1.5px solid #bfdbfe',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#2563eb',
                  boxShadow: '0 2px 8px rgba(37, 99, 235, 0.08)'
                }}>
                  <ProfileVectorIcon type={currentProfile.iconType} size={24} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.96rem', color: '#0f172a' }}>{currentProfile.title}</div>
                    <span style={{ fontSize: '0.7rem', background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: '12px', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s162', "نشط الآن")}</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>{currentProfile.subtitle}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProfileModalOpen(true)}
                disabled={disabled}
                style={{
                  background: '#ffffff',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '7px 16px',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  color: '#1e40af',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  transition: 'all 0.15s ease'
                }}
              >
                <span>{t('settings.forms.tabs.modules_settings_tab.s163', "تغيير نشاط الصيانة والقالب")}</span>
                <ChevronDownIcon size={14} color="#64748b" />
              </button>
            </div>

            <div className="document-prototype-grid compact-grid-2">
              <div className="field">
                <label style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px', display: 'block', fontSize: '0.82rem' }}>
                  {t('settings.forms.tabs.modules_settings_tab.s164', "نسبة عمولة فني الصيانة من صافي المصنعية (%)")}
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  className="purchase-prototype-field-input"
                  {...form.register('technicianCommissionRate')}
                  disabled={disabled}
                  placeholder="30"
                  style={{ fontWeight: 700, background: '#ffffff' }}
                />
                <small className="muted">{t('settings.forms.tabs.modules_settings_tab.s165', "تُحسب العمولة تلقائيًا كنسبة مئوية من صافي ربح المصنعية بعد خصم سعر قطع الغيار.")}</small>
              </div>

              <div className="field">
                <label style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px', display: 'block', fontSize: '0.82rem' }}>
                  {t('settings.forms.tabs.modules_settings_tab.s166', "الملحقات الافتراضية للفحص والاستلام السريع")}
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                  {currentProfile.defaultAccessories.map((acc) => (
                    <span key={acc} style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 9px', borderRadius: '6px', fontSize: '0.74rem', color: '#334155', fontWeight: 600, boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                      + {acc}
                    </span>
                  ))}
                </div>
                <small className="muted">{t('settings.forms.tabs.modules_settings_tab.s167', "تظهر هذه الملحقات كأزرار سريعة بضغطة زر داخل شاشة تذاكر الصيانة.")}</small>
              </div>
            </div>
          </div>
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

        {weightedBarcodeEnabled && ((!isContractingVertical && !isMaritimeVertical) || isSuperAdmin) ? (
          <div className="document-prototype-grid compact-grid-2" style={{ marginTop: 16 }}>
            <div className="field">
              <label>{t('settings.forms.tabs.modules_settings_tab.s176', "بداية باركود الميزان")}</label>
              <input className="purchase-prototype-field-input" inputMode="numeric" {...form.register('weightedBarcodePrefix')} disabled={disabled} placeholder="21" />
            </div>
            <div className="field">
              <label>{t('settings.forms.tabs.modules_settings_tab.s177', "أرقام كود الصنف")}</label>
              <input className="purchase-prototype-field-input" type="number" min="3" max="8" {...form.register('weightedBarcodeProductCodeLength')} disabled={disabled} />
            </div>
            <div className="field">
              <label>{t('settings.forms.tabs.modules_settings_tab.s178', "أرقام الوزن")}</label>
              <input className="purchase-prototype-field-input" type="number" min="3" max="8" {...form.register('weightedBarcodeWeightDigits')} disabled={disabled} />
            </div>
            <div className="field">
              <label>{t('settings.forms.tabs.modules_settings_tab.s179', "دقة الوزن (خانات عشرية)")}</label>
              <input className="purchase-prototype-field-input" type="number" min="0" max="3" {...form.register('weightedBarcodeWeightDecimals')} disabled={disabled} />
            </div>
            <div className="field">
              <label>{t('settings.forms.tabs.modules_settings_tab.s180', "محتوى باركود الميزان")}</label>
              <select className="purchase-prototype-field-input" {...form.register('weightedBarcodeValueMode')} disabled={disabled}>
                <option value="weight">{t('settings.forms.tabs.modules_settings_tab.s181', "وزن الصنف")}</option>
                <option value="price">{t('settings.forms.tabs.modules_settings_tab.s182', "السعر الإجمالي بالصغرى (قرشان / هللتان)")}</option>
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
