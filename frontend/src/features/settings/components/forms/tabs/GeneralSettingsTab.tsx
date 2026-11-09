import { useTranslation } from 'react-i18next';
import { useEffect, memo } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { Branch, Location } from '@/types/domain';
import { SUPPORTED_CURRENCIES } from '@/lib/currencies';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import { readFileAsDataUrl, RequiredField, comboListStyle, comboRowStyle, comboCreateStyle } from '@/features/settings/components/forms/settings-forms.shared';
import { applyAccentColorToDocument } from '@/lib/theme';
import { ShieldCheckIcon } from '@/shared/components/icons/AppIcons';
import { useAuthStore } from '@/stores/auth-store';
import { isPlatformAdmin } from '@/app/router/access';
import { CustomSelect } from '@/shared/ui/custom-select';
import { toast } from '@/shared/components/system-alert';

function getPillarBadgeInfo(rawActivity?: string | null, pillar?: string | null, isEn = false) {
  const norm = String(rawActivity || pillar || 'retail_general').trim().toLowerCase();
  if (norm === 'contracting' || norm === 'construction' || norm === 'مقاولات') {
    return {
      shortTitle: isEn ? 'Contracting ERP' : 'قطاع المقاولات',
      title: isEn ? 'Contracting & Construction Management' : 'قطاع المقاولات وإدارة المشاريع الإنشائية',
      badge: isEn ? 'Projects & BOQ' : 'مشاريع ومقايسات',
      desc: isEn ? 'Integrated workspace for projects, BOQ, IPCs, subcontractor contracts, purchasing, warehouses, and accounting.' : 'بيئة عمل متكاملة للمشاريع والمقايسات (BOQ) والمستخلصات وعقود مقاولي الباطن والمشتريات والمخازن والحسابات.',
      color: '#0284c7',
      bg: '#f0f9ff',
      borderColor: '#bae6fd',
    };
  }
  if (norm === 'maritime_freight' || norm === 'maritime' || norm === 'freight' || norm === 'shipping' || norm === 'شحن') {
    return {
      shortTitle: isEn ? 'Maritime Freight' : 'قطاع الشحن',
      title: isEn ? 'Maritime Freight & Logistics' : 'قطاع الشحن البحري واللوجستيات',
      badge: isEn ? 'Ocean & Containers' : 'نولون وحاويات',
      desc: isEn ? 'Integrated system for shipping lines, ports, freight RFQ, operation orders, and demurrage tracking.' : 'بيئة عمل متكاملة للخطوط الملاحية، الموانئ، مقارنة أسعار النولون (RFQ)، أوامر التشغيل وتتبع الحاويات.',
      color: '#0d9488',
      bg: '#f0fdfa',
      borderColor: '#99f6e4',
    };
  }
  if (norm === 'pharmacy' || norm === 'صيدلية') {
    return {
      shortTitle: isEn ? 'Commerce' : 'قطاع التجارة',
      title: isEn ? 'Commerce: Pharmacies & Medical Supplies' : 'قطاع التجارة: صيدليات ومستلزمات طبية',
      badge: isEn ? 'FEFO Pharmacy' : 'صيدليات FEFO',
      desc: isEn ? 'Integrated management of drugs & alternatives, batch tracking & expiry dates, and prescriptions.' : 'إدارة متكاملة للأدوية والبدائل، تتبع التشغيلات وتواريخ انتهاء الصلاحية، والروشتات.',
      color: '#16a34a',
      bg: '#f0fdf4',
      borderColor: '#bbf7d0',
    };
  }
  if (norm === 'restaurant' || norm === 'cafe' || norm === 'مطعم') {
    return {
      shortTitle: isEn ? 'Commerce' : 'قطاع التجارة',
      title: isEn ? 'Commerce: Restaurants & Cafes' : 'قطاع التجارة: مطاعم وكافيهات وضيافة',
      badge: isEn ? 'Restaurant KDS' : 'مطاعم KDS',
      desc: isEn ? 'Kitchen display system, dining tables, meal modifiers & toppings, and fast takeaway.' : 'إدارة متكاملة لشاشات المطبخ، خيارات الوجبات والإضافات، والصالات ونقاط البيع.',
      color: '#ea580c',
      bg: '#fff7ed',
      borderColor: '#fed7aa',
    };
  }
  if (norm === 'manufacturing' || norm === 'تصنيع') {
    return {
      shortTitle: isEn ? 'Manufacturing' : 'قطاع التصنيع',
      title: isEn ? 'Commerce: Industrial Production' : 'قطاع التجارة: تصنيع وخطوط إنتاج خفيف',
      badge: isEn ? 'BOM Production' : 'تصنيع BOM',
      desc: isEn ? 'Bills of materials (BOM), work orders, production routing, and manufacturing costing.' : 'إدارة متكاملة لقوائم المكونات (BOM)، أوامر التشغيل والإنتاج، وحساب التكاليف الصناعية.',
      color: '#7c3aed',
      bg: '#f5f3ff',
      borderColor: '#ddd6fe',
    };
  }
  if (norm === 'maintenance' || norm === 'electronics' || norm === 'صيانة') {
    return {
      shortTitle: isEn ? 'Commerce' : 'قطاع التجارة',
      title: isEn ? 'Commerce: Maintenance & Service Centers' : 'قطاع التجارة: مراكز صيانة وخدمة أجهزة',
      badge: isEn ? 'Job Cards' : 'كروت صيانة',
      desc: isEn ? 'Device intake, warranty cards, IMEI serial tracking, and spare parts.' : 'إدارة متكاملة لكروت فحص واستلام الأجهزة، قطع الغيار المستهلكة، وتتبع أرقام السيريال.',
      color: '#2563eb',
      bg: '#eff6ff',
      borderColor: '#bfdbfe',
    };
  }
  if (norm === 'auto_parts' || norm === 'autoparts' || norm === 'قطع_غيار') {
    return {
      shortTitle: isEn ? 'Commerce' : 'قطاع التجارة',
      title: isEn ? 'Commerce: Auto Parts & Equipment' : 'قطاع التجارة: قطع غيار ومعدات',
      badge: isEn ? 'Auto Parts OEM' : 'قطع غيار',
      desc: isEn ? 'Parts directory, OEM numbers, vehicle compatibility and cross-reference.' : 'إدارة متكاملة لأكواد قطع الغيار، سنة الصنع، والموديلات المتوافقة.',
      color: '#b45309',
      bg: '#fffbeb',
      borderColor: '#fde68a',
    };
  }
  if (norm === 'import_export' || norm === 'import' || norm === 'استيراد') {
    return {
      shortTitle: isEn ? 'Commerce' : 'قطاع التجارة',
      title: isEn ? 'Commerce: Import & International Trade' : 'قطاع التجارة: استيراد وتصدير وشراكة',
      badge: isEn ? 'Import & Customs' : 'استيراد وتصدير',
      desc: isEn ? 'Customs shipments, overseas vendor payables, and landed cost tracking.' : 'إدارة متكاملة للشحنات الاستيرادية وتكاليف الوصول ومستندات الشحن.',
      color: '#0369a1',
      bg: '#f0f9ff',
      borderColor: '#bae6fd',
    };
  }
  if (norm === 'clothing' || norm === 'fashion' || norm === 'ملابس') {
    return {
      shortTitle: isEn ? 'Commerce' : 'قطاع التجارة',
      title: isEn ? 'Commerce: Apparel & Fashion' : 'قطاع التجارة: أزياء وملابس ومقاسات',
      badge: isEn ? 'Fashion Matrix' : 'ملابس ومقاسات',
      desc: isEn ? 'Multi-variant size and color matrix, fashion barcode generation, and seasonal styles.' : 'إدارة متكاملة للمقاسات والألوان وتوليد الباركود التلقائي للمصفوفة.',
      color: '#db2777',
      bg: '#fdf2f8',
      borderColor: '#fbcfe8',
    };
  }
  return {
    shortTitle: isEn ? 'Commerce' : 'قطاع التجارة',
    title: isEn ? 'Commerce & Retail Business' : 'قطاع التجارة وإدارة الأعمال العامة',
    badge: isEn ? 'Retail & POS' : 'تجزئة ومستودعات',
    desc: isEn ? 'Fast POS, warehouses & inventory, purchasing, and financial accounts.' : 'إدارة متكاملة لنقاط البيع السريعة، المخازن والمستودعات، المشتريات، والحسابات المالية.',
    color: '#170e5e',
    bg: '#eef2ff',
    borderColor: '#c7d2fe',
  };
}

function getIndustrySummary(ind?: string, isEn = false) {
  const norm = String(ind || 'general').trim().toLowerCase();
  switch (norm) {
    case 'contracting':
    case 'construction':
    case 'مقاولات':
      return isEn ? 'Contracting & Construction Management' : 'قطاع المقاولات وإدارة المشاريع الإنشائية';
    case 'maritime_freight':
    case 'maritime':
    case 'freight':
    case 'shipping':
    case 'شحن':
      return isEn ? 'Maritime Freight & Logistics' : 'قطاع الشحن البحري واللوجستيات';
    case 'fashion':
      return isEn ? 'Apparel, Sizes & Variant Matrix' : 'موديول الملابس والمقاسات ومصفوفة الأصناف';
    case 'perfumes':
      return isEn ? 'Perfume Formulations & Packaging' : 'موديول تركيبات العطور والعبوات';
    case 'pharmacy':
    case 'صيدلية':
      return isEn ? 'Pharmacy, Medications & Expiry (FEFO)' : 'موديول الصيدلية والأدوية وتواريخ الصلاحية (FEFO)';
    case 'electronics':
    case 'maintenance':
    case 'صيانة':
      return isEn ? 'Maintenance Cards, Devices & Serial/IMEI' : 'موديول كروت الصيانة والأجهزة والسيريال والـ IMEI';
    case 'cafe':
    case 'restaurant':
    case 'مطعم':
      return isEn ? 'Restaurants, Cafes & Kitchen Displays (KDS)' : 'موديول المطاعم والكافيهات وشاشات المطبخ (KDS)';
    case 'manufacturing':
    case 'تصنيع':
      return isEn ? 'Industrial Production & Bills of Materials (BOM)' : 'موديول التصنيع وقوائم المكونات (BOM)';
    case 'general':
    default:
      return isEn ? 'Standard Commercial & General Business Management' : 'النشاط التجاري القياسي وإدارة الأعمال العامة';
  }
}

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

function BrandAvatarAndTitlePreview({
  control,
  accentColor,
  logoData,
  children,
}: {
  control: any;
  accentColor: string;
  logoData?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const storeName = useWatch({ control, name: 'storeName' });
  const brandName = useWatch({ control, name: 'brandName' });

  return (
    <>
      <div
        style={{
          width: '50px',
          height: '50px',
          borderRadius: '8px',
          border: `2px solid ${accentColor}`,
          background: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {logoData ? (
          <img src={logoData} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <span style={{ fontSize: '1.3rem', fontWeight: 900, color: accentColor }}>
            {(storeName || brandName || 'Z').slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {storeName || t('settings.forms.tabs.general_settings_tab.s0', "اسم النشاط / المتجر")}
        </div>
        <div style={{ fontSize: '0.74rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {brandName || 'Z Systems'}
        </div>
        {children}
      </div>
    </>
  );
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
        
        {/* Card 1: الهوية وبيانات النشاط (Store Identity & Basic Info) */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}>
          {/* Section Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <strong style={{ fontSize: '0.95rem', color: '#0f172a', fontWeight: 800, display: 'block' }}>
                {t('settings.forms.tabs.general_settings_tab.s1', "الهوية وبيانات النشاط")}
              </strong>
              <span style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.general_settings_tab.s2', "الاسم والشعار وبيانات التواصل المطبوعة")}</span>
            </div>
          </div>

          {/* Interactive Logo & Brand Header with Operational Sector Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '10px 14px',
            flexWrap: 'wrap',
          }}>
            {/* Right: Logo Preview box + Brand details */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: '1 1 200px' }}>
              <BrandAvatarAndTitlePreview control={form.control} accentColor={accentColor} logoData={logoData}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px' }}>
                  <label style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: '#0f172a',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '5px',
                    padding: '2px 8px',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}>
                    {logoData ? t('settings.forms.tabs.general_settings_tab.s3', "تغيير الشعار") : t('settings.forms.tabs.general_settings_tab.s4', "رفع شعار")}
                    <input
                      type="file"
                      style={{ display: 'none' }}
                      accept="image/*"
                      disabled={disabled}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        try {
                          form.setValue('logoData', await readFileAsDataUrl(file), { shouldDirty: true, shouldValidate: true });
                        } finally {
                          event.currentTarget.value = '';
                        }
                      }}
                    />
                  </label>

                  {logoData && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => form.setValue('logoData', '', { shouldDirty: true, shouldValidate: true })}
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        color: '#b91c1c',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '2px 6px',
                      }}
                    >
                      {t('settings.forms.tabs.general_settings_tab.s5', "حذف")}
                    </button>
                  )}
                </div>
              </BrandAvatarAndTitlePreview>
            </div>

            {/* Left: Compact Enterprise Sector & Activity Badge */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: info.bg,
                border: `1px solid ${info.borderColor}`,
                borderRadius: '8px',
                padding: '5px 10px',
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
              title={
                isSuperAdmin
                  ? t('settings.forms.tabs.general_settings_tab.s6', "وضع السوبر أدمن: التعديل متاح من تبويب تخصيص المنظومة والنشاط")
                  : t('settings.forms.tabs.general_settings_tab.s7', "نمط معتمد ومثبت للمنشأة لحماية سلامة القيود")
              }
            >
              <ShieldCheckIcon size={14} color={info.color} />
              <strong style={{ fontSize: '0.78rem', color: '#0f172a', fontWeight: 800 }}>
                {info.shortTitle || info.title}
              </strong>
              <span
                style={{
                  fontSize: '0.66rem',
                  background: '#ffffff',
                  color: info.color,
                  border: `1px solid ${info.borderColor}`,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontWeight: 700,
                }}
              >
                {info.badge}
              </span>
            </div>
          </div>

          {/* Form Fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <RequiredField label={storeNameLabel} error={form.formState.errors.storeName?.message}>
              <input
                className="purchase-prototype-field-input"
                placeholder={storeNamePlaceholder}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-lpignore="true"
                {...form.register('storeName')}
                disabled={disabled}
                style={{ padding: '7px 10px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </RequiredField>

            <div className="field">
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{t('settings.forms.tabs.general_settings_tab.s8', "نشاط المنشأة والقطاع الفعال")}</span>
                <span style={{ fontSize: '0.7rem', background: info.bg, color: info.color, border: `1px solid ${info.borderColor}`, padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                  {info.badge}
                </span>
              </label>
              <div style={{ padding: '8px 12px', borderRadius: '6px', background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '0.82rem', color: '#0f172a', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                <span>{getIndustrySummary(form.watch('businessIndustry') || rawAct, isEn)}</span>
                <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>{t('settings.forms.tabs.general_settings_tab.s9', "نمط معتمد ومثبت للمنشأة")}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="field">
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s10', "الهاتف")}</label>
                <input
                  className="purchase-prototype-field-input"
                  placeholder="010xxxxxxxx"
                  autoComplete="off"
                  autoCorrect="off"
                  data-lpignore="true"
                  {...form.register('phone')}
                  disabled={disabled}
                  style={{ padding: '7px 10px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </div>

              <div className="field">
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s11', "العنوان")}</label>
                <input
                  className="purchase-prototype-field-input"
                  placeholder={t('settings.forms.tabs.general_settings_tab.s12', "المدينة - الشارع")}
                  autoComplete="off"
                  autoCorrect="off"
                  data-lpignore="true"
                  {...form.register('address')}
                  disabled={disabled}
                  style={{ padding: '7px 10px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </div>
            </div>

            {/* Color Selection Inline */}
            <div className="field">
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s13', "لون الواجهة المخصص")}</label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => form.setValue('accentColor', e.target.value, { shouldDirty: true })}
                  disabled={disabled}
                  style={{ width: '38px', height: '36px', padding: '2px', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer' }}
                />
                <input
                  type="text"
                  placeholder="#170c5c"
                  {...form.register('accentColor')}
                  disabled={disabled}
                  style={{ flex: 1, padding: '7px 10px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontFamily: 'monospace', direction: 'ltr' }}
                />
                <button
                  type="button"
                  onClick={() => form.setValue('accentColor', '#170c5c', { shouldDirty: true })}
                  disabled={disabled}
                  style={{ padding: '7px 10px', fontSize: '0.75rem', fontWeight: 600, borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  {t('settings.forms.tabs.general_settings_tab.s14', "الافتراضي")}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: إعدادات التشغيل والفرع والمخزون (Store Operations & Stock) */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
            <div>
              <strong style={{ fontSize: '0.95rem', color: '#0f172a', fontWeight: 800, display: 'block' }}>
                {isContractingVertical ? t('settings.forms.tabs.general_settings_tab.s15', "المقر الإداري ومواقع العمل") : isMaritimeVertical ? t('settings.forms.tabs.general_settings_tab.s16', "المكتب والمقر الملاحي الرئيسي") : t('settings.forms.tabs.general_settings_tab.s17', "إعدادات التشغيل والمخزون")}
              </strong>
              <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
                {isContractingVertical ? t('settings.forms.tabs.general_settings_tab.s18', "مقر الإدارة ومخزن التشوين الميداني الافتراضي") : isMaritimeVertical ? t('settings.forms.tabs.general_settings_tab.s19', "المكتب المعتمد كمركز إدارة وتنسيق العمليات والتوكيلات الملاحية") : t('settings.forms.tabs.general_settings_tab.s20', "الفرع الرئيسي ومخازن ونمط الكاشير")}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Branch Selector */}
            {SINGLE_STORE_MODE ? (
              <RequiredField label={branchFieldLabel} error={form.formState.errors.currentBranchId?.message}>
                <input
                  className="purchase-prototype-field-input"
                  value={selectedBranch?.name || t('settings.forms.tabs.general_settings_tab.s21', "سيتم الربط تلقائيًا بعد حفظ بيانات النشاط الرئيسي")}
                  disabled
                  readOnly
                  style={{ padding: '7px 10px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc' }}
                />
              </RequiredField>
            ) : (
              <RequiredField label={branchFieldLabel} error={form.formState.errors.currentBranchId?.message}>
                <div style={{ position: 'relative' }}>
                  <input
                    className="purchase-prototype-field-input"
                    value={branchQuery}
                    placeholder={t('settings.forms.tabs.general_settings_tab.s22', "ابحث أو اكتب اسم فرع جديد لإضافته")}
                    name="settings_branch_search"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-form-type="other"
                    role="combobox"
                    aria-expanded={branchMenuOpen}
                    disabled={disabled}
                    onFocus={() => setBranchMenuOpen(true)}
                    onChange={(event) => {
                      setBranchQuery(event.target.value);
                      setBranchMenuOpen(true);
                      form.clearErrors('currentBranchId');
                      form.clearErrors('currentLocationId');
                      form.clearErrors('root.serverError');
                    }}
                    onBlur={() => {
                      window.setTimeout(() => setBranchMenuOpen(false), 120);
                    }}
                    style={{ padding: '7px 10px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1', width: '100%', boxSizing: 'border-box' }}
                  />
                  {branchMenuOpen && branchMenuHasContent ? (
                    <div style={{ ...comboListStyle, position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20 }}>
                      {filteredBranches.map((branch) => (
                        <button
                          key={branch.id}
                          type="button"
                          style={comboRowStyle}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            commitSelectedBranch(String(branch.id), String(branch.name || ''));
                          }}
                        >
                          {branch.name}
                        </button>
                      ))}
                      {branchCreateOptionVisible ? (
                        <button
                          type="button"
                          style={comboCreateStyle}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setBranchPrefillName(branchQuery.trim());
                            setShowBranchQuickAdd(true);
                            setBranchMenuOpen(false);
                          }}
                        >
                          {t('settings.forms.tabs.general_settings_tab.s23', "+ إضافة فرع جديد: \"")}{branchQuery.trim()}&quot;
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </RequiredField>
            )}

            {/* Maritime Operations Settings OR Receiving Location & Cashier Mode Grid */}
            {isMaritimeVertical ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="field">
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>
                    {t('settings.forms.tabs.general_settings_tab.s24', "عملة تسعير النولون الافتراضية")}
                  </label>
                  <CustomSelect
                    value={form.watch('maritimeDefaultCurrency') || 'USD'}
                    onChange={(val) => form.setValue('maritimeDefaultCurrency', val as any, { shouldDirty: true, shouldValidate: true })}
                    options={[
                      { value: 'USD', label: t('settings.forms.tabs.general_settings_tab.s25', "دولار أمريكي (USD)") },
                      { value: 'EUR', label: t('settings.forms.tabs.general_settings_tab.s26', "يورو (EUR)") },
                      { value: 'EGP', label: t('settings.forms.tabs.general_settings_tab.s27', "جنيه مصري (EGP)") },
                    ]}
                    disabled={disabled}
                  />
                </div>
                <div className="field">
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>
                    {t('settings.forms.tabs.general_settings_tab.s28', "أيام السماح المجانية للحاويات (Demurrage)")}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    className="purchase-prototype-field-input"
                    value={Number(form.watch('maritimeDemurrageFreeDays') || 14)}
                    onChange={(e) => form.setValue('maritimeDemurrageFreeDays', Math.max(1, parseInt(e.target.value) || 14), { shouldDirty: true, shouldValidate: true })}
                    disabled={disabled}
                    style={{ padding: '7px 10px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1', width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: isNonPosVertical ? '1fr' : '1fr 1fr', gap: '10px' }}>
                <RequiredField label={locationFieldLabel} error={form.formState.errors.currentLocationId?.message}>
                  {visibleLocations.length === 0 ? (
                    <div style={{ padding: '6px 8px', background: '#fee2e2', color: '#991b1b', borderRadius: '6px', fontSize: '0.78rem' }}>
                      {t('settings.forms.tabs.general_settings_tab.s29', "لا توجد أماكن مخزون.")}
                    </div>
                  ) : (
                    <CustomSelect
                      value={form.watch('currentLocationId') || ''}
                      onChange={(val) => form.setValue('currentLocationId', val, { shouldDirty: true, shouldValidate: true })}
                      options={[
                        { value: '', label: t('settings.forms.tabs.general_settings_tab.s30', "-- اختر المخزن --") },
                        ...visibleLocations.map((loc) => ({ value: String(loc.id), label: loc.name })),
                      ]}
                      disabled={disabled}
                    />
                  )}
                </RequiredField>

                {!isNonPosVertical && (
                  <div className="field">
                    <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s31', "نمط الكاشير الافتراضي")}</label>
                    <CustomSelect
                      value={form.watch('defaultPosMode') || 'scanner'}
                      onChange={(val) => form.setValue('defaultPosMode', val as any, { shouldDirty: true, shouldValidate: true })}
                      options={[
                        { value: 'scanner', label: t('settings.forms.tabs.general_settings_tab.s32', "سكانر باركود") },
                        { value: 'touch', label: t('settings.forms.tabs.general_settings_tab.s33', "لمس (تاتش)") },
                      ]}
                      disabled={disabled}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Sales Stock Source (Branch-level stock settings) */}
            {!isNonPosVertical && selectedBranch && onUpdateBranch && (
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '10px 12px',
                marginTop: '4px',
              }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                  {t('settings.forms.tabs.general_settings_tab.s34', "مصدر مخزون البيع للفرع (")}{selectedBranch.name})
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('settings.forms.tabs.general_settings_tab.s35', "نطاق المخزون")}</label>
                    <CustomSelect
                      value={stockMode}
                      disabled={!canManageSettings || branchStockSaving}
                      onChange={(val) => { setStockMode(val as any); setBranchStockDirty(true); setBranchStockSaved(false); }}
                      options={[
                        { value: 'single_location', label: t('settings.forms.tabs.general_settings_tab.s36', "مخزن محدد") },
                        { value: 'all_operational_locations', label: t('settings.forms.tabs.general_settings_tab.s37', "كل المخازن التشغيلية") },
                      ]}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('settings.forms.tabs.general_settings_tab.s38', "مخزن البيع الأساسي")}</label>
                    <CustomSelect
                      value={defaultStockLocationId}
                      disabled={!canManageSettings || branchStockSaving}
                      onChange={(val) => { setDefaultStockLocationId(val); setBranchStockDirty(true); setBranchStockSaved(false); }}
                      options={[
                        { value: '', label: t('settings.forms.tabs.general_settings_tab.s39', "-- غير محدد --") },
                        ...locations.filter((loc) => !loc.branchId || loc.branchId === selectedBranch.id).map((loc) => ({
                          value: String(loc.id),
                          label: loc.name,
                        })),
                      ]}
                    />
                  </div>
                </div>

                {stockMode === 'all_operational_locations' && (
                  <div style={{ marginTop: '6px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.76rem', color: '#334155', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={allowExternalSalesStock}
                        disabled={!canManageSettings || branchStockSaving}
                        onChange={(e) => { setAllowExternalSalesStock(e.target.checked); setBranchStockDirty(true); setBranchStockSaved(false); }}
                      />
                      {t('settings.forms.tabs.general_settings_tab.s40', "السماح بالبيع من المخازن الخارجية")}
                    </label>
                  </div>
                )}

                {branchStockDirty && canManageSettings && (
                  <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      disabled={branchStockSaving}
                      onClick={async () => {
                        if (!selectedBranch) return;
                        setBranchStockSaving(true);
                        setBranchStockError(null);
                        try {
                          await onUpdateBranch(selectedBranch.id, {
                            name: selectedBranch.name || '',
                            code: selectedBranch.code || '',
                            defaultStockLocationId: defaultStockLocationId || undefined,
                            salesStockMode: stockMode,
                            allowExternalSalesStock,
                          });
                          setBranchStockSaved(true);
                          setBranchStockDirty(false);
                        } catch {
                          setBranchStockError(t('settings.forms.tabs.general_settings_tab.s41', "تعذر حفظ إعدادات المخزون."));
                        } finally {
                          setBranchStockSaving(false);
                        }
                      }}
                      style={{
                        padding: '5px 12px',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        borderRadius: '6px',
                        background: '#0f172a',
                        color: '#ffffff',
                        border: 'none',
                        cursor: branchStockSaving ? 'wait' : 'pointer',
                      }}
                    >
                      {branchStockSaving ? t('settings.forms.tabs.general_settings_tab.s42', "جارٍ الحفظ...") : t('settings.forms.tabs.general_settings_tab.s43', "حفظ إعدادات مخزون الفرع")}
                    </button>
                  </div>
                )}

                {branchStockSaved && <div style={{ color: '#16a34a', marginTop: '4px', fontSize: '0.75rem', fontWeight: 600 }}>{t('settings.forms.tabs.general_settings_tab.s44', "تم حفظ إعدادات مخزون البيع بنجاح.")}</div>}
                {branchStockError && <div style={{ color: '#dc2626', marginTop: '4px', fontSize: '0.75rem', fontWeight: 600 }}>{branchStockError}</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Card: نمط تشغيل المنشأة ونطاق العمل (Facility Operation Mode) */}
      {!isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isWholesaleVertical && !isWarehousingVertical && (
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '16px 20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <strong style={{ fontSize: '0.95rem', color: '#0f172a', fontWeight: 800, display: 'block' }}>
                {t('settings.forms.tabs.general_settings_tab.s45', "نمط تشغيل المنشأة ونطاق العمل (Operation Mode)")}
              </strong>
              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                {t('settings.forms.tabs.general_settings_tab.s46', "اختر النمط المناسب لحجم نشاطك لضبط القوائم والواجهات؛ يتم تدوين القيود المحاسبية في الخلفية تلقائياً في كلا النمطين.")}
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
              {form.watch('enableEnterpriseFeatures') ? t('settings.forms.tabs.general_settings_tab.s47', "النمط المؤسسي المتقدم") : t('settings.forms.tabs.general_settings_tab.s48', "النمط التجاري المبسط")}
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
                    {t('settings.forms.tabs.general_settings_tab.s49', "محل تجاري ونقاط بيع مبسطة (Simple Retail)")}
                  </strong>
                </div>
                <span style={{ fontSize: '0.7rem', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('settings.forms.tabs.general_settings_tab.s50', "موصى به للمحلات")}
                </span>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                {t('settings.forms.tabs.general_settings_tab.s51', "واجهة رشيقة وسريعة للكاشير ونقاط البيع والفواتير المباشرة والمخزون، مع الخزينة والمصروفات اليومية. تخفي الشيكات والبنوك وقيود اليومية وأوامر الشراء والأرفف لمنع التشتيت وسرعة الإنجاز.")}
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
                    {t('settings.forms.tabs.general_settings_tab.s52', "مؤسسة تجارية متقدمة (Enterprise Trading)")}
                  </strong>
                </div>
                <span style={{ fontSize: '0.7rem', background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('settings.forms.tabs.general_settings_tab.s53', "محاسبة متقدمة")}
                </span>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                {t('settings.forms.tabs.general_settings_tab.s54', "تفعيل الدورة المستندية الكاملة: أوامر الشراء والبيع، عروض الأسعار (RFQ)، شجرة المخازن والأرفف، المحاسبة العامة، شجرة الحسابات، قيود اليومية، حافظة الشيكات (PDC)، والتسويات البنكية ومراكز التكلفة.")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Card 3: التفضيلات والمنطقة والتواصل (Regional & Preferences) */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong style={{ fontSize: '0.95rem', color: '#0f172a', fontWeight: 800, display: 'block' }}>
              {t('settings.forms.tabs.general_settings_tab.s55', "اللغة والمنطقة والتواصل")}
            </strong>
            <span style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.general_settings_tab.s56', "العملة، التوقيت، وتنسيق التواريخ والواتساب")}</span>
          </div>
          <span style={{ fontSize: '0.72rem', background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '4px', border: '1px solid #e2e8f0', fontWeight: 600, flexShrink: 0 }}>
            {t('settings.forms.tabs.general_settings_tab.s57', "التفضيلات")}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
          <div className="field">
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s58', "دولة المقر / التشغيل")}</label>
            <CustomSelect
              value={form.watch('country') || (form.watch('currency') === 'KWD' ? 'KW' : form.watch('currency') === 'SAR' ? 'SA' : 'EG')}
              onChange={(val) => {
                form.setValue('country', val, { shouldDirty: true, shouldValidate: true });
                if (val === 'KW') {
                  form.setValue('currency', 'KWD', { shouldDirty: true, shouldValidate: true });
                  form.setValue('timezone', 'Asia/Kuwait', { shouldDirty: true, shouldValidate: true });
                  form.setValue('taxRate', 0, { shouldDirty: true, shouldValidate: true });
                  form.setValue('taxNumber', '', { shouldDirty: true, shouldValidate: true });
                  form.setValue('printShowTaxNumber', false, { shouldDirty: true, shouldValidate: true });
                  form.setValue('posTerminalProvider', 'knet_pos', { shouldDirty: true, shouldValidate: true });
                  form.setValue('printNumberFormat', 'english', { shouldDirty: true, shouldValidate: true });
                  toast.success(t('settings.forms.tabs.general_settings_tab.s59', "تم تفعيل إعدادات دولة الكويت بنجاح: د.ك (3 خانات - فلس)، أرقام لاتينية قياسية، ضريبة 0%، وشبكة كي نت K-NET."));
                } else if (val === 'SA') {
                  form.setValue('currency', 'SAR', { shouldDirty: true, shouldValidate: true });
                  form.setValue('timezone', 'Asia/Riyadh', { shouldDirty: true, shouldValidate: true });
                  form.setValue('taxRate', 15, { shouldDirty: true, shouldValidate: true });
                  form.setValue('printShowTaxNumber', true, { shouldDirty: true, shouldValidate: true });
                  toast.success(t('settings.forms.tabs.general_settings_tab.s60', "تم تفعيل إعدادات المملكة العربية السعودية: ريال سعودي، ضريبة 15%، وهيئة الزكاة والضريبة ZATCA."));
                } else if (val === 'EG') {
                  form.setValue('currency', 'EGP', { shouldDirty: true, shouldValidate: true });
                  form.setValue('timezone', 'Africa/Cairo', { shouldDirty: true, shouldValidate: true });
                  form.setValue('taxRate', 14, { shouldDirty: true, shouldValidate: true });
                } else if (val === 'AE') {
                  form.setValue('currency', 'AED', { shouldDirty: true, shouldValidate: true });
                  form.setValue('timezone', 'Asia/Dubai', { shouldDirty: true, shouldValidate: true });
                  form.setValue('taxRate', 5, { shouldDirty: true, shouldValidate: true });
                } else if (val === 'QA') {
                  form.setValue('currency', 'QAR', { shouldDirty: true, shouldValidate: true });
                  form.setValue('timezone', 'Asia/Qatar', { shouldDirty: true, shouldValidate: true });
                  form.setValue('taxRate', 0, { shouldDirty: true, shouldValidate: true });
                } else if (val === 'BH') {
                  form.setValue('currency', 'BHD', { shouldDirty: true, shouldValidate: true });
                  form.setValue('timezone', 'Asia/Bahrain', { shouldDirty: true, shouldValidate: true });
                  form.setValue('taxRate', 10, { shouldDirty: true, shouldValidate: true });
                } else if (val === 'OM') {
                  form.setValue('currency', 'OMR', { shouldDirty: true, shouldValidate: true });
                  form.setValue('timezone', 'Asia/Muscat', { shouldDirty: true, shouldValidate: true });
                  form.setValue('taxRate', 5, { shouldDirty: true, shouldValidate: true });
                }
              }}
              options={[
                { value: 'KW', label: t('settings.forms.tabs.general_settings_tab.s61', "دولة الكويت (Kuwait)") },
                { value: 'SA', label: t('settings.forms.tabs.general_settings_tab.s62', "المملكة العربية السعودية (KSA)") },
                { value: 'EG', label: t('settings.forms.tabs.general_settings_tab.s63', "جمهورية مصر العربية (Egypt)") },
                { value: 'AE', label: t('settings.forms.tabs.general_settings_tab.s64', "دولة الإمارات (UAE)") },
                { value: 'QA', label: t('settings.forms.tabs.general_settings_tab.s65', "دولة قطر (Qatar)") },
                { value: 'BH', label: t('settings.forms.tabs.general_settings_tab.s66', "مملكة البحرين (Bahrain)") },
                { value: 'OM', label: t('settings.forms.tabs.general_settings_tab.s67', "سلطنة عُمان (Oman)") },
              ]}
              disabled={disabled}
            />
          </div>

          <div className="field">
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s68', "لغة النظام")}</label>
            <CustomSelect
              value={form.watch('uiLanguage') || 'ar'}
              onChange={(val) => {
                form.setValue('uiLanguage', val as any, { shouldDirty: true, shouldValidate: true });
                if (val === 'en' || val === 'ar') {
                  import('@/lib/i18n').then(({ default: i18n }) => {
                    i18n.changeLanguage(val);
                  });
                }
              }}
              options={[
                { value: 'ar', label: t('settings.forms.tabs.general_settings_tab.s69', "العربية") },
                { value: 'en', label: 'English' },
              ]}
              disabled={disabled}
            />
          </div>

          <div className="field">
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s70', "العملة")}</label>
            <CustomSelect
              value={form.watch('currency') || 'EGP'}
              onChange={(val) => {
                form.setValue('currency', val, { shouldDirty: true, shouldValidate: true });
                if (val === 'KWD' && form.watch('country') !== 'KW') {
                  form.setValue('country', 'KW', { shouldDirty: true, shouldValidate: true });
                } else if (val === 'SAR' && form.watch('country') !== 'SA') {
                  form.setValue('country', 'SA', { shouldDirty: true, shouldValidate: true });
                }
              }}
              options={SUPPORTED_CURRENCIES.map((c) => ({ value: c.code, label: c.label }))}
              disabled={disabled}
            />
          </div>

          <div className="field">
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s71', "المنطقة الزمنية")}</label>
            <CustomSelect
              value={form.watch('timezone') || 'Africa/Cairo'}
              onChange={(val) => form.setValue('timezone', val, { shouldDirty: true, shouldValidate: true })}
              options={[
                { value: 'Africa/Cairo', label: t('settings.forms.tabs.general_settings_tab.s72', "مصر (Africa/Cairo)") },
                { value: 'Asia/Riyadh', label: t('settings.forms.tabs.general_settings_tab.s73', "السعودية (Asia/Riyadh)") },
                { value: 'Asia/Kuwait', label: t('settings.forms.tabs.general_settings_tab.s74', "الكويت (Asia/Kuwait)") },
                { value: 'Asia/Qatar', label: t('settings.forms.tabs.general_settings_tab.s75', "قطر (Asia/Qatar)") },
                { value: 'Asia/Dubai', label: t('settings.forms.tabs.general_settings_tab.s76', "الإمارات (Asia/Dubai)") },
                { value: 'Asia/Bahrain', label: t('settings.forms.tabs.general_settings_tab.s77', "البحرين (Asia/Bahrain)") },
                { value: 'Asia/Muscat', label: t('settings.forms.tabs.general_settings_tab.s78', "عُمان (Asia/Muscat)") },
                { value: 'UTC', label: t('settings.forms.tabs.general_settings_tab.s79', "التوقيت العالمي (UTC)") },
              ]}
              disabled={disabled}
            />
          </div>

          <div className="field">
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s80', "صيغة التاريخ")}</label>
            <CustomSelect
              value={form.watch('dateFormat') || 'dd/MM/yyyy'}
              onChange={(val) => form.setValue('dateFormat', val as any, { shouldDirty: true, shouldValidate: true })}
              options={[
                { value: 'yyyy-MM-dd', label: '2026-06-07 (ISO)' },
                { value: 'dd/MM/yyyy', label: '07/06/2026' },
              ]}
              disabled={disabled}
            />
          </div>

          <div className="field">
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s81', "صيغة الوقت")}</label>
            <CustomSelect
              value={form.watch('timeFormat') || '12h'}
              onChange={(val) => form.setValue('timeFormat', val as any, { shouldDirty: true, shouldValidate: true })}
              options={[
                { value: '24h', label: t('settings.forms.tabs.general_settings_tab.s82', "24 ساعة") },
                { value: '12h', label: t('settings.forms.tabs.general_settings_tab.s83', "12 ساعة (ص/م)") },
              ]}
              disabled={disabled}
            />
          </div>

          <div className="field">
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s84', "رابط إرسال الواتساب")}</label>
            <CustomSelect
              value={form.watch('whatsappLinkMode') || 'wa_me'}
              onChange={(val) => form.setValue('whatsappLinkMode', val as any, { shouldDirty: true, shouldValidate: true })}
              options={[
                { value: 'wa_me', label: t('settings.forms.tabs.general_settings_tab.s85', "افتراضي (يسأل المستخدم)") },
                { value: 'web', label: t('settings.forms.tabs.general_settings_tab.s86', "واتساب ويب مباشرة") },
                { value: 'app', label: t('settings.forms.tabs.general_settings_tab.s87', "تطبيق الواتساب مباشرة") },
              ]}
              disabled={disabled}
            />
          </div>
        </div>

        {/* Kuwait Regional Profile Active Banner */}
        {(form.watch('country') === 'KW' || form.watch('currency') === 'KWD') && (
          <div style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '10px',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '0.8rem',
            color: '#166534',
            marginTop: '4px',
          }}>
            <ShieldCheckIcon size={18} color="#16a34a" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <strong style={{ fontSize: '0.84rem' }}>{t('settings.forms.tabs.general_settings_tab.s88', "الملف الإقليمي لدولة الكويت مفعّل بالكامل")}</strong>
              <span style={{ fontSize: '0.74rem', color: '#15803d' }}>
                {t('settings.forms.tabs.general_settings_tab.s89', "دقة الأسعار 3 خانات عشرية (فلس)، ضريبة 0%، شبكة كي نت (K-NET)، منصة كاري (Cari)، ونموذج عناوين المعلومات المدنية (PACI). يمكنك تعديل أي حقل مخصص يدوياً بحرية.")}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  if (prev.activeTab !== 'general' && next.activeTab !== 'general') {
    return true;
  }
  return false;
});
