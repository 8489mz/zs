import { useTranslation } from 'react-i18next';
import { useEffect, memo } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { Branch, Location } from '@/types/domain';
import { applyAccentColorToDocument } from '@/lib/theme';
import { useAuthStore } from '@/stores/auth-store';
import { isPlatformAdmin } from '@/app/router/access';
import { getPillarBadgeInfo } from './general-settings-tab/general-settings-tab-shared';
import { GeneralSettingsBrand } from './general-settings-tab/general-settings-brand';
import { GeneralSettingsBranchStock } from './general-settings-tab/general-settings-branch-stock';
import { GeneralSettingsVerticals } from './general-settings-tab/general-settings-verticals';
import { GeneralSettingsPreferences } from './general-settings-tab/general-settings-preferences';


interface GeneralTabProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  branches?: Branch[];
  locations?: Location[];
  canManageSettings: boolean;
  disabled: boolean;
  activeTab: string;
  branchQuery: string;
  setBranchQuery: (val: string) => void;
  filteredBranches: Branch[];
  selectedBranch?: Branch;
  stockMode: 'single_location' | 'all_operational_locations';
  setStockMode: (val: 'single_location' | 'all_operational_locations') => void;
  defaultStockLocationId: string;
  setDefaultStockLocationId: (val: string) => void;
  allowExternalSalesStock: boolean;
  setAllowExternalSalesStock: (val: boolean) => void;
  branchStockSaving: boolean;
  setBranchStockSaving: (val: boolean) => void;
  branchStockSaved: boolean;
  setBranchStockSaved: (val: boolean) => void;
  branchStockError: string | null;
  setBranchStockError: (val: string | null) => void;
  branchStockDirty: boolean;
  setBranchStockDirty: (val: boolean) => void;
  branchMenuOpen: boolean;
  setBranchMenuOpen: (val: boolean) => void;
  branchMenuHasContent: boolean;
  branchCreateOptionVisible: boolean;
  commitSelectedBranch: (branchId: string, branchName?: string) => void;
  setBranchPrefillName: (val: string) => void;
  setShowBranchQuickAdd: (val: boolean) => void;
  visibleLocations?: Location[];
  onUpdateBranch?: (id: any, data: any) => Promise<any>;
}


export const GeneralSettingsTab = memo(function GeneralSettingsTab({
  form,
  canManageSettings,
  disabled,
  activeTab,
  branchQuery,
  setBranchQuery,
  filteredBranches,
  selectedBranch,
  stockMode,
  setStockMode,
  defaultStockLocationId,
  setDefaultStockLocationId,
  allowExternalSalesStock,
  setAllowExternalSalesStock,
  branchStockSaving,
  setBranchStockSaving,
  branchStockSaved,
  setBranchStockSaved,
  branchStockError,
  setBranchStockError,
  branchStockDirty,
  setBranchStockDirty,
  branchMenuOpen,
  setBranchMenuOpen,
  branchMenuHasContent,
  branchCreateOptionVisible,
  commitSelectedBranch,
  setBranchPrefillName,
  setShowBranchQuickAdd,
  visibleLocations = [],
  locations = [],
  onUpdateBranch,
}: GeneralTabProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const accentColor = form.watch('accentColor') || '#170c5c';
  const logoData = form.watch('logoData');
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = isPlatformAdmin(user) || (user?.role === 'super_admin' && String(user?.username || '').trim().toLowerCase() === 'zs');
  const tenant = useAuthStore((s) => s.tenant);
  const businessIndustry = form.watch('businessIndustry');

  useEffect(() => {
    if (accentColor) {
      applyAccentColorToDocument(accentColor);
    }
  }, [accentColor]);

  const rawAct = String(businessIndustry || tenant?.activityType || 'retail_general').trim().toLowerCase();
  const isContractingVertical = rawAct === 'contracting' || rawAct === 'construction' || rawAct === 'مقاولات' || Boolean(form.watch('contractingModuleEnabled'));
  const isMaritimeVertical = rawAct === 'maritime_freight' || rawAct === 'maritime' || rawAct === 'freight' || rawAct === 'shipping' || rawAct === 'شحن' || Boolean(form.watch('maritimeFreightModuleEnabled'));
  const isManufacturingVertical = rawAct === 'manufacturing' || rawAct === 'production' || rawAct === 'تصنيع' || rawAct === 'مصنع' || Boolean(form.watch('manufacturingModuleEnabled'));
  // INV-REST-SUCCESS-FEEDBACK-TRUTH: wholesale and warehousing force
  // enableEnterpriseFeatures: true at every layer (form defaults, submit
  // handler, backend read/update paths), so the operation-mode choice is
  // not a real choice for them either — the card stays hidden here exactly
  // as it already does for contracting/maritime/manufacturing.
  const isWholesaleVertical = rawAct === 'wholesale_van' || rawAct === 'wholesale' || rawAct === 'distribution' || rawAct.includes('توزيع') || rawAct.includes('فان') || rawAct.includes('جمل');
  const isWarehousingVertical = rawAct === 'warehousing' || rawAct === 'warehouse' || rawAct === 'wms' || rawAct.includes('مخازن') || rawAct.includes('مستودع');
  const isServicesVertical = rawAct === 'services' || rawAct === 'consulting' || rawAct === 'استشارات';
  const isImportVertical = rawAct === 'import_export' || rawAct === 'import';
  const isRestaurantVertical = ['restaurant', 'cafe', 'مطعم', 'كافيه'].includes(rawAct) || Boolean(form.watch('restaurantModuleEnabled'));
  const isPharmacyVertical = ['pharmacy', 'صيدلية', 'صيدليات'].includes(rawAct) || Boolean(form.watch('enablePharmacyModule'));
  const isClothingVertical = ['clothing', 'fashion', 'ملابس', 'أزياء'].includes(rawAct) || Boolean(form.watch('clothingModuleEnabled'));
  const isAutoPartsVertical = ['auto_parts', 'autoparts', 'قطع_غيار', 'قطع غيار'].includes(rawAct) || Boolean(form.watch('autoPartsModuleEnabled'));
  const isMaintenanceVertical = ['maintenance', 'electronics', 'صيانة'].includes(rawAct) || Boolean(form.watch('enableMobileStoreFeatures'));
  const isNonPosVertical = isContractingVertical || isMaritimeVertical || isServicesVertical || isManufacturingVertical;

  const storeNameLabel = isContractingVertical
    ? (isEn ? 'Contracting Company / Enterprise Name' : 'اسم شركة المقاولات / المؤسسة')
    : isMaritimeVertical
    ? (isEn ? 'Shipping Agency / Maritime Company Name' : 'اسم شركة الشحن والتوكيلات الملاحية')
    : isManufacturingVertical
    ? (isEn ? 'Factory / Industrial Facility Name' : 'اسم المصنع / المنشأة الصناعية')
    : isImportVertical
    ? (isEn ? 'Import & Export Company Name' : 'اسم شركة الاستيراد والتصدير')
    : isServicesVertical
    ? (isEn ? 'Consulting & Services Office Name' : 'اسم المكتب / الشركة الاستشارية والخدمية')
    : isRestaurantVertical
    ? (isEn ? 'Restaurant / Cafe Name' : 'اسم المطعم / الكافيه')
    : isPharmacyVertical
    ? (isEn ? 'Pharmacy / Medical Facility Name' : 'اسم الصيدلية / المؤسسة العلاجية')
    : isClothingVertical
    ? (isEn ? 'Boutique / Fashion Store Name' : 'اسم المتجر / بوتيك الأزياء')
    : isAutoPartsVertical
    ? (isEn ? 'Auto Parts Center / Store Name' : 'اسم المركز / محل قطع الغيار')
    : isMaintenanceVertical
    ? (isEn ? 'Service Center / Repair Shop Name' : 'اسم المركز / محل صيانة الأجهزة')
    : (isEn ? 'Business / Store Name' : 'اسم النشاط / المتجر');

  const storeNamePlaceholder = isContractingVertical
    ? (isEn ? 'e.g., Modern Contracting & Construction Co.' : 'مثال: شركة المقاولات والإنشاءات الحديثة')
    : isMaritimeVertical
    ? (isEn ? 'e.g., Maritime Shipping & Logistics Co.' : 'مثال: شركة الملاحة والخدمات اللوجستية')
    : isManufacturingVertical
    ? (isEn ? 'e.g., Al-Noor Industrial Manufacturing' : 'مثال: مصنع النور للصناعات والتجميع')
    : isImportVertical
    ? (isEn ? 'e.g., International Group for Import & Export' : 'مثال: المجموعة الدولية للاستيراد والتصدير')
    : isServicesVertical
    ? (isEn ? 'e.g., Business Advisory Group' : 'مثال: المجموعة الاستشارية للأعمال')
    : isRestaurantVertical
    ? (isEn ? 'e.g., Eastern Restaurant & Cafe' : 'مثال: مطعم وكافيه الشرق')
    : isPharmacyVertical
    ? (isEn ? 'e.g., Al-Hayat Pharmacies' : 'مثال: صيدليات الحياة الكبرى')
    : isClothingVertical
    ? (isEn ? 'e.g., Elite Fashion & Apparel' : 'مثال: دار النخبة للأزياء والملابس')
    : isAutoPartsVertical
    ? (isEn ? 'e.g., Certified Auto Parts Center' : 'مثال: المركز المعتمد لقطع غيار السيارات')
    : isMaintenanceVertical
    ? (isEn ? 'e.g., Tech Center for Device Repair' : 'مثال: مركز التقنية لصيانة الأجهزة والموبايل')
    : (isEn ? 'e.g., Al-Attar Store' : 'مثال: محلات رجب العطار');

  const locationFieldLabel = isContractingVertical
    ? (isEn ? 'Default Site / Staging Warehouse' : 'مخزن الموقع / التشوين الافتراضي')
    : (isEn ? 'Default Receiving Location' : 'مكان الاستلام الافتراضي');

  const branchFieldLabel = isContractingVertical
    ? (isEn ? 'Management HQ / Main Branch' : 'مقر الإدارة / الفرع الرئيسي')
    : isMaritimeVertical
    ? (isEn ? 'Main Shipping Office / Branch' : 'المكتب / الفرع الملاحي الرئيسي')
    : (isEn ? 'Main Branch' : 'الفرع الرئيسي');

  const info = getPillarBadgeInfo(rawAct, tenant?.pillar, isEn);

  return (
    <div style={{ display: activeTab === 'general' ? 'flex' : 'none', flexDirection: 'column', gap: '16px' }}>
      {/* Top 2-Column Balanced Dashboard */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '16px' }}>
        
        <GeneralSettingsBrand
          t={t}
          form={form}
          accentColor={accentColor}
          logoData={logoData}
          disabled={disabled}
          info={info}
          isSuperAdmin={isSuperAdmin}
          storeNameLabel={storeNameLabel}
          storeNamePlaceholder={storeNamePlaceholder}
          rawAct={rawAct}
          isEn={isEn}
        />

        <GeneralSettingsBranchStock
          isContractingVertical={isContractingVertical}
          t={t}
          isMaritimeVertical={isMaritimeVertical}
          branchFieldLabel={branchFieldLabel}
          form={form}
          selectedBranch={selectedBranch}
          branchQuery={branchQuery}
          branchMenuOpen={branchMenuOpen}
          disabled={disabled}
          setBranchMenuOpen={setBranchMenuOpen}
          setBranchQuery={setBranchQuery}
          branchMenuHasContent={branchMenuHasContent}
          filteredBranches={filteredBranches}
          commitSelectedBranch={commitSelectedBranch}
          branchCreateOptionVisible={branchCreateOptionVisible}
          setBranchPrefillName={setBranchPrefillName}
          setShowBranchQuickAdd={setShowBranchQuickAdd}
          isNonPosVertical={isNonPosVertical}
          locationFieldLabel={locationFieldLabel}
          visibleLocations={visibleLocations}
          onUpdateBranch={onUpdateBranch}
          stockMode={stockMode}
          canManageSettings={canManageSettings}
          branchStockSaving={branchStockSaving}
          setStockMode={setStockMode}
          setBranchStockDirty={setBranchStockDirty}
          setBranchStockSaved={setBranchStockSaved}
          defaultStockLocationId={defaultStockLocationId}
          setDefaultStockLocationId={setDefaultStockLocationId}
          locations={locations}
          allowExternalSalesStock={allowExternalSalesStock}
          setAllowExternalSalesStock={setAllowExternalSalesStock}
          branchStockDirty={branchStockDirty}
          setBranchStockSaving={setBranchStockSaving}
          setBranchStockError={setBranchStockError}
          branchStockSaved={branchStockSaved}
          branchStockError={branchStockError}
        />
      </div>

      <GeneralSettingsVerticals
        isContractingVertical={isContractingVertical}
        isMaritimeVertical={isMaritimeVertical}
        isManufacturingVertical={isManufacturingVertical}
        isWholesaleVertical={isWholesaleVertical}
        isWarehousingVertical={isWarehousingVertical}
        t={t}
        form={form}
        disabled={disabled}
      />

      <GeneralSettingsPreferences
        t={t}
        form={form}
        disabled={disabled}
      />
    </div>
  );
}, (prev, next) => {
  if (prev.activeTab !== 'general' && next.activeTab !== 'general') {
    return true;
  }
  return false;
});
