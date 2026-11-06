import { useTranslation } from 'react-i18next';
import { translateUiText } from '@/lib/auto-translator';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/shared/components/page-header';
import { SearchIcon } from '@/shared/components/icons/AppIcons';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { useAuthStore } from '@/stores/auth-store';
import { isPlatformAdmin } from '@/app/router/access';
import { settingsApi } from '@/features/settings/api/settings.api';
import { queryKeys } from '@/app/query-keys';
import { PLAN_TIERS, type PlanTierKey } from '@/features/settings/components/modular-configurator/modular-presets';
import { APPS_CATALOG } from '../data/apps-catalog';
import { AppCard } from '../components/AppCard';
import { AppsKpiHeader } from '../components/AppsKpiHeader';
import { AppUpgradeModal } from '../components/AppUpgradeModal';
import type { AppCategoryKey, AppItemDefinition } from '../types/apps-store.types';

function ContractingBuildingIcon({ size = 20, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 9h6M9 13h6M9 17h6" />
    </svg>
  );
}

function CargoShipIcon({ size = 20, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.5 0 2.5 2 5 2 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.26.94 4.3 2.45 5.82" />
      <path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4" />
      <path d="M12 2v4" />
    </svg>
  );
}

const CATEGORY_TABS: Array<{ id: AppCategoryKey; label: string }> = [
  { id: 'all', label: 'كافة التطبيقات' },
  { id: 'installed', label: 'المثبتة والنشطة' },
  { id: 'pos', label: 'المبيعات' },
  { id: 'inventory', label: 'المخازن' },
  { id: 'finance', label: 'المالية والمحاسبة' },
  { id: 'contracting', label: 'المقاولات' },
  { id: 'maritime', label: 'الشحن' },
  { id: 'specialized', label: 'الخدمات' },
  { id: 'logistics', label: 'اللوجستيات' },
];

const CONTRACTING_ALLOWED_KEYS = new Set([
  'contractingModuleEnabled',
  'purchasesModuleEnabled',
  'inventoryModuleEnabled',
  'hrModuleEnabled',
  'enableEnterpriseFeatures',
  'fixedAssetsModuleEnabled',
  'taxDeclarationModuleEnabled',
]);

const MARITIME_ALLOWED_KEYS = new Set([
  'maritimeFreightModuleEnabled',
  'purchasesModuleEnabled',
  'hrModuleEnabled',
  'enableEnterpriseFeatures',
  'fixedAssetsModuleEnabled',
  'taxDeclarationModuleEnabled',
]);

export function AppsStorePage() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const isSuperAdmin = isPlatformAdmin(user) || (user?.role === 'super_admin' && String(user?.username || '').trim().toLowerCase() === 'zs');

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<AppCategoryKey>('all');
  const [upgradeModalApp, setUpgradeModalApp] = useState<AppItemDefinition | null>(null);

  // Fetch current settings
  const { data: settings, isLoading } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => settingsApi.settings(),
    staleTime: 60_000,
  });

  const rawActivity = String(tenant?.activityType || tenant?.pillar || (settings as any)?.businessIndustry || (settings as any)?.activityType || '').trim().toLowerCase();
  const isContractingVertical = rawActivity === 'contracting' || rawActivity === 'construction' || rawActivity === 'مقاولات';
  const isMaritimeVertical = rawActivity === 'maritime_freight' || rawActivity === 'maritime' || rawActivity === 'freight' || rawActivity === 'shipping' || rawActivity === 'شحن';

  // Scoped visible catalog based on business vertical
  const visibleCatalog = useMemo(() => {
    if (isSuperAdmin) return APPS_CATALOG;

    if (isContractingVertical) {
      return APPS_CATALOG.filter((app) => CONTRACTING_ALLOWED_KEYS.has(app.key));
    }

    if (isMaritimeVertical) {
      return APPS_CATALOG.filter((app) => MARITIME_ALLOWED_KEYS.has(app.key));
    }

    // Commerce mode: hide dedicated vertical suites unless tenant has specific feature.
    // Sector-identity modules (featureFlag set to the same code industry-profiles.ts grants
    // that sector) are hidden from every OTHER sector too — a pharmacy tenant shouldn't see
    // "Restaurant Module" any more than a contracting one sees POS. Still shown when the
    // tenant already has the flag (their own sector, or an add-on granted via extraFeatures —
    // e.g. manufacturing installed on top of a non-manufacturing activity). PRICING_AND_PACKAGING.md
    // §11 C5.
    const SECTOR_IDENTITY_FLAGS = new Set(['contracting', 'maritime_freight', 'restaurant', 'clothing', 'pharmacy', 'manufacturing', 'import']);
    return APPS_CATALOG.filter((app) => {
      if (app.featureFlag && SECTOR_IDENTITY_FLAGS.has(app.featureFlag)) {
        return tenant?.features?.includes(app.featureFlag) ?? false;
      }
      return true;
    });
  }, [isSuperAdmin, isContractingVertical, isMaritimeVertical, tenant]);

  const availableCategories = useMemo(() => {
    const presentCategories = new Set<AppCategoryKey>();
    for (const app of visibleCatalog) {
      presentCategories.add(app.category);
    }
    return CATEGORY_TABS.filter((tab) => {
      if (tab.id === 'all') return true;
      if (tab.id === 'installed') return true;
      return presentCategories.has(tab.id);
    });
  }, [visibleCatalog]);

  // Settings update mutation
  const updateMutation = useMutation({
    mutationFn: (partialSettings: Record<string, any>) => settingsApi.update(partialSettings),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      const changedKey = Object.keys(variables)[0];
      const isEnabled = variables[changedKey];
      const appDef = APPS_CATALOG.find((a) => a.key === changedKey);
      const appTitle = appDef?.title || 'التطبيق';
      if (isEnabled) {
        toast.success(`تم تفعيل وتثبيت [${appTitle}] بنجاح وتم تحديث القوائم والشاشات.`);
      } else {
        toast.info(`تم إلغاء تفعيل [${appTitle}] بنجاح.`);
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر تحديث حالة التطبيق، يرجى المحاولة مرة أخرى.');
    },
  });

  // Helper to check if an app is active
  const isAppActive = (appKey: string): boolean => {
    if (!settings) return false;
    return Boolean((settings as any)[appKey]);
  };

  // Helper to check if tenant plan/features allow this app
  const isAppAllowedByPlan = (app: AppItemDefinition): boolean => {
    if (isSuperAdmin) return true;
    if (isContractingVertical && CONTRACTING_ALLOWED_KEYS.has(app.key)) return true;
    if (isMaritimeVertical && MARITIME_ALLOWED_KEYS.has(app.key)) return true;
    if (app.featureFlag) {
      const tenantFeatures = tenant?.features || [];
      if (!tenantFeatures.includes(app.featureFlag)) {
        return false;
      }
    }
    // Plan tiers hierarchy
    const rawPlan = String(tenant?.plan || tenant?.planId || 'pro').toLowerCase();
    const planHierarchy: Record<string, number> = {
      basic: 1,
      plan_basic: 1,
      standard: 1,
      pro: 2,
      plan_pro: 2,
      ultimate: 3,
      plan_ultimate: 3,
      omnichannel: 4,
      plan_omnichannel: 4,
    };
    const requiredRankMap: Record<PlanTierKey, number> = {
      plan_basic: 1,
      plan_pro: 2,
      plan_ultimate: 3,
      plan_omnichannel: 4,
    };
    const tenantRank = planHierarchy[rawPlan] || planHierarchy[rawPlan.replace('plan_', '')] || 2;
    const requiredRank = requiredRankMap[app.requiredPlan] || 3;
    return tenantRank >= requiredRank;
  };

  // Handle Toggle App (Install or Uninstall)
  const handleToggle = async (app: AppItemDefinition, currentStatus: boolean) => {
    if (updateMutation.isPending) return;

    if (!isSuperAdmin && (currentStatus || !isAppAllowedByPlan(app))) {
      toast.warning('إدارة وتثبيت الموديولات مخصصة حصرياً لإدارة المنصة (السوبر أدمن). يرجى التواصل لترقية باقتك وتفعيل الموديول المطلوب.');
      return;
    }

    if (currentStatus) {

      // Confirm uninstallation to prevent accidental disabling of critical modules
      const confirmed = await systemConfirm({
        title: `إلغاء تفعيل [${app.title}]`,
        message: `هل أنت متأكد من رغبتك في إيقاف وإلغاء تثبيت تطبيق [${app.title}]؟ سيتم إخفاء الشاشات المرتبطة به من القوائم للمستخدمين.`,
        confirmText: 'نعم، إيقاف التطبيق',
        cancelText: 'إلغاء',
        variant: 'warning',
      });
      if (!confirmed) return;

      updateMutation.mutate({ [app.key]: false });
    } else {
      // Check dependencies if any
      if (app.dependencies && app.dependencies.length > 0) {
        const missingDeps = app.dependencies.filter((depKey) => !isAppActive(depKey));
        if (missingDeps.length > 0) {
          const depTitles = missingDeps.map((k) => APPS_CATALOG.find((a) => a.key === k)?.title || k).join('، ');
          const proceed = await systemConfirm({
            title: 'تفعيل المتطلبات المرتبطة',
            message: `يتطلب تطبيق [${app.title}] تشغيل التطبيقات التالية أولاً: (${depTitles}). هل ترغب في تفعيلها معاً الآن؟`,
            confirmText: 'تفعيل الكل معاً',
            cancelText: 'إلغاء',
            variant: 'primary',
          });
          if (!proceed) return;

          const payload: Record<string, boolean> = { [app.key]: true };
          for (const depKey of missingDeps) {
            payload[depKey] = true;
          }
          updateMutation.mutate(payload);
          return;
        }
      }

      updateMutation.mutate({ [app.key]: true });
    }
  };

  // Filtered Apps
  const filteredApps = useMemo(() => {
    return visibleCatalog.filter((app) => {
      const active = isAppActive(app.key);

      // Category filter
      if (selectedCategory === 'installed' && !active) return false;
      if (selectedCategory !== 'all' && selectedCategory !== 'installed' && app.category !== selectedCategory) {
        return false;
      }

      // Search filter
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchTitle = app.title.toLowerCase().includes(q);
        const matchDesc = app.shortDesc.toLowerCase().includes(q);
        const matchCat = app.categoryLabel.toLowerCase().includes(q);
        const matchFeat = app.features.some((f) => f.toLowerCase().includes(q));
        if (!matchTitle && !matchDesc && !matchCat && !matchFeat) return false;
      }

      return true;
    });
  }, [visibleCatalog, selectedCategory, search, settings]);

  // Statistics
  const activeAppsCount = useMemo(() => {
    return visibleCatalog.filter((a) => isAppActive(a.key)).length;
  }, [visibleCatalog, settings]);

  const availableToInstallCount = useMemo(() => {
    return visibleCatalog.filter((a) => !isAppActive(a.key) && isAppAllowedByPlan(a)).length;
  }, [visibleCatalog, settings, tenant, isSuperAdmin, isContractingVertical, isMaritimeVertical]);

  const currentPlanName = useMemo(() => {
    if (isContractingVertical) return isEn ? 'Contracting All-Inclusive Suite' : 'باقة المقاولات الشاملة (All-Inclusive)';
    if (isMaritimeVertical) return isEn ? 'Maritime Freight All-Inclusive Suite' : 'باقة الشحن واللوجستيات (All-Inclusive)';
    const raw = String(tenant?.plan || tenant?.planId || 'pro').toLowerCase();
    const map: Record<string, string> = {
      basic: isEn ? 'Basic Plan' : PLAN_TIERS.plan_basic.name,
      pro: isEn ? 'Pro Enterprise Plan' : PLAN_TIERS.plan_pro.name,
      ultimate: isEn ? 'Ultimate Enterprise Plan' : PLAN_TIERS.plan_ultimate.name,
      omnichannel: isEn ? 'Omnichannel Enterprise Plan' : PLAN_TIERS.plan_omnichannel.name,
    };
    return map[raw] || (isEn ? 'Ultimate Enterprise Plan' : PLAN_TIERS.plan_ultimate.name);
  }, [tenant, isContractingVertical, isMaritimeVertical, isEn]);

  return (
    <div className="page-stack page-shell apps-store-page">
      <main
        className="document-prototype-column"
        style={{
          paddingBottom: '100px',
          maxWidth: '1280px',
          width: 'min(100%, 1280px)',
          margin: '0 auto',
        }}
      >
        <PageHeader
          title={t('apps_store.apps_store_page.s0', "متجر التطبيقات والموديولات (Apps Store)")}
          description={t('apps_store.apps_store_page.s1', "مركز تطبيقات وإضافات المنظومة الشامل: قم بتثبيت وتفعيل التطبيقات التخصصية لنشاطك، وتخصيص بيئة العمل بمرونة تامة بضغطة زر واحدة.")}
          badge={<span className="nav-pill">{activeAppsCount} {t('apps_store.apps_store_page.s2', "من أصل")} {visibleCatalog.length} {t('apps_store.apps_store_page.s3', "تطبيقاً نشطاً")}</span>}
        />

        {/* All-Inclusive Suite Banners for Vertical Modes */}
        {isContractingVertical && !isSuperAdmin && (
          <div
            style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '14px',
              padding: '14px 18px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            }}
          >
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: '#dcfce7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#15803d',
                flexShrink: 0,
              }}
            >
              <ContractingBuildingIcon size={22} color="#15803d" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#166534', marginBottom: '2px' }}>
                {t('apps_store.apps_store_page.s4', "باقة المقاولات الشاملة (All-Inclusive Suite)")}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#15803d', lineHeight: 1.5 }}>
                {t('apps_store.apps_store_page.s5', "تم ضبط المتجر تلقائياً لقطاع المقاولات والهندسة الإنشائية؛ كافة الموديولات الداعمة (المشاريع، المستخلصات، مقاولو الباطن، مستودعات المواقع، الأصول، والمحاسبة) مدمجة بالكامل ومفعلة ضمن باقتك الموحدة دون الحاجة لاشتراكات إضافية.")}
              </div>
            </div>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#166534',
                background: '#dcfce7',
                padding: '4px 10px',
                borderRadius: '8px',
                whiteSpace: 'nowrap',
              }}
            >
              {t('apps_store.apps_store_page.s6', "باقة قطاعية مدمجة")}
            </span>
          </div>
        )}

        {isMaritimeVertical && !isSuperAdmin && (
          <div
            style={{
              background: '#f0f9ff',
              border: '1px solid #bae6fd',
              borderRadius: '14px',
              padding: '14px 18px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            }}
          >
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: '#e0f2fe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0284c7',
                flexShrink: 0,
              }}
            >
              <CargoShipIcon size={22} color="#0284c7" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0369a1', marginBottom: '2px' }}>
                {t('apps_store.apps_store_page.s7', "باقة الشحن واللوجستيات الملاحية (All-Inclusive Suite)")}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#0284c7', lineHeight: 1.5 }}>
                {t('apps_store.apps_store_page.s8', "تم ضبط المتجر تلقائياً لقطاع التوكيلات الملاحية والشحن الدولي؛ كافة الموديولات المتخصصة (الشحن، خطوط الملاحة، المشتريات، المحاسبة ومراكز التكلفة، وشؤون الموظفين) مدمجة بالكامل ومحمية ضمن الباقة الشاملة.")}
              </div>
            </div>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#0369a1',
                background: '#e0f2fe',
                padding: '4px 10px',
                borderRadius: '8px',
                whiteSpace: 'nowrap',
              }}
            >
              {t('apps_store.apps_store_page.s9', "باقة قطاعية مدمجة")}
            </span>
          </div>
        )}

        {/* Top KPI Summary Header */}
        <AppsKpiHeader
          totalApps={visibleCatalog.length}
          activeAppsCount={activeAppsCount}
          availableToInstallCount={availableToInstallCount}
          currentPlanName={currentPlanName}
          isSuperAdmin={isSuperAdmin}
        />

        {/* Toolbar: Search and Filter Pills */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '14px 18px',
            marginBottom: '22px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          {/* Instant Search Bar */}
          <div style={{ position: 'relative', width: '100%' }}>
            <span style={{ position: 'absolute', right: '14px', top: '11px', color: '#94a3b8' }}>
              <SearchIcon size={16} />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('apps_store.apps_store_page.s10', "ابحث في التطبيقات، الموديولات، أو المزايا...")}
              style={{
                width: '100%',
                paddingRight: '38px',
                paddingLeft: '14px',
                paddingTop: '9px',
                paddingBottom: '9px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.8125rem',
                outline: 'none',
                boxSizing: 'border-box',
                background: '#f8fafc',
              }}
            />
          </div>

          {/* Category Filter Pills */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              backgroundColor: '#f1f5f9',
              padding: '6px',
              borderRadius: '10px',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            {availableCategories.map((tab) => {
              const isActive = selectedCategory === tab.id;
              // Count for this tab
              let count = 0;
              if (tab.id === 'all') count = visibleCatalog.length;
              else if (tab.id === 'installed') count = activeAppsCount;
              else count = visibleCatalog.filter((a) => a.category === tab.id).length;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedCategory(tab.id)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '7px',
                    border: 'none',
                    backgroundColor: isActive ? '#ffffff' : 'transparent',
                    color: isActive ? '#170e5e' : '#64748b',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{isEn ? (translateUiText(tab.label) || tab.label) : tab.label}</span>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      background: isActive ? '#eef2ff' : '#e2e8f0',
                      color: isActive ? '#170e5e' : '#475569',
                      padding: '1px 7px',
                      borderRadius: '10px',
                      fontWeight: 800,
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Apps Grid Layout */}
        {isLoading ? (
          <div
            style={{
              minHeight: '360px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#ffffff',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
              color: '#64748b',
              fontSize: '0.88rem',
            }}
          >
            {t('apps_store.apps_store_page.s11', "جاري تحميل كتالوج التطبيقات...")}
          </div>
        ) : filteredApps.length === 0 ? (
          <div
            style={{
              minHeight: '320px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#ffffff',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
              padding: '40px 20px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
              {t('apps_store.apps_store_page.s12', "لا توجد تطبيقات مطابقة لبحثك")}
            </div>
            <p style={{ fontSize: '0.8125rem', color: '#64748b', maxWidth: '400px', margin: '0 0 16px 0' }}>
              {t('apps_store.apps_store_page.s13', "لم نعثر على أي تطبيق يطابق كلمة البحث \"")}{search}{t('apps_store.apps_store_page.s14', "\" أو التصنيف المحدد.")}
            </p>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setSelectedCategory('all');
              }}
              style={{
                padding: '7px 18px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#170e5e',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {t('apps_store.apps_store_page.s15', "عرض كافة التطبيقات")}
            </button>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
              gap: '18px',
            }}
          >
            {filteredApps.map((app) => (
              <AppCard
                key={app.key}
                app={app}
                isActive={isAppActive(app.key)}
                isAllowedByPlan={isAppAllowedByPlan(app)}
                isPending={updateMutation.isPending}
                isSuperAdmin={isSuperAdmin}
                isCoreSuiteApp={
                  !isSuperAdmin &&
                  ((isContractingVertical && CONTRACTING_ALLOWED_KEYS.has(app.key)) ||
                    (isMaritimeVertical && MARITIME_ALLOWED_KEYS.has(app.key)))
                }
                onToggle={handleToggle}
                onOpenUpgradeModal={(a) => setUpgradeModalApp(a)}
              />
            ))}
          </div>
        )}

        {/* Upgrade Dialog */}
        <AppUpgradeModal
          app={upgradeModalApp}
          isOpen={Boolean(upgradeModalApp)}
          onClose={() => setUpgradeModalApp(null)}
        />
      </main>
    </div>
  );
}
