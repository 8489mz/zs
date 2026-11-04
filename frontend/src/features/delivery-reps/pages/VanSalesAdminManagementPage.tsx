import { useTranslation } from 'react-i18next';
import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { settingsApi } from '@/features/settings';
import { systemAlert, systemConfirm, toast } from '@/shared/components/system-alert';
import { deliveryRepsApi } from '@/shared/api/delivery-reps.api';
import {
  TruckIcon,
  SearchIcon,
  UsersIcon,
  SlidersIcon,
  CopyIcon,
  FileTextIcon,
  CheckCircleIcon,
  MapPinIcon,
  RefreshCwIcon,
  CheckShieldIcon,
  CreditCardIcon,
} from '@/shared/components/icons/AppIcons';
import { FleetVehiclesTab } from '../components/FleetVehiclesTab';
import { VanTripsTab } from '../components/VanTripsTab';
import { VanFinancialLedgerAdminTab } from '../components/VanFinancialLedgerAdminTab';
import { VanLoadRequisitionsAdminTab } from '../components/VanLoadRequisitionsAdminTab';
import { VanFieldReturnsAdminTab } from '../components/VanFieldReturnsAdminTab';
import { VanRepTargetsAdminTab } from '../components/VanRepTargetsAdminTab';
import { VanRoutesKpiAdminTab } from '../components/VanRoutesKpiAdminTab';
import { VanPreSalesAdminTab } from '../components/VanPreSalesAdminTab';
import { VanFraudRadarAdminTab } from '../components/VanFraudRadarAdminTab';
import { VanPromotionsAdminTab } from '../components/VanPromotionsAdminTab';
import { VanVisitsTrackingAdminTab } from '../components/VanVisitsTrackingAdminTab';
import { UpsertDeliveryRepModal } from '@/shared/components/delivery-reps/UpsertDeliveryRepModal';
import { useVanSalesAdmin, type DeliveryRep } from '../hooks/useVanSalesAdmin';
import { vanSalesApi } from '../api/van-sales.api';

type VanAdminTabKey = 'trips' | 'financial_ledger' | 'requisitions' | 'presales' | 'routes_kpis' | 'returns' | 'radar' | 'targets' | 'promotions' | 'visits_tracking' | 'fleet' | 'drivers';

export default function VanSalesAdminManagementPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as VanAdminTabKey | null;

  const [activeTab, setActiveTab] = useState<VanAdminTabKey>(
    () => tabParam || 'trips',
  );

  useEffect(() => {
    if (tabParam && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  // Drivers Tab State
  const [driverSearch, setDriverSearch] = useState('');
  const [isUpsertRepOpen, setIsUpsertRepOpen] = useState(false);
  const [editingRep, setEditingRep] = useState<DeliveryRep | null>(null);

  // Settlement & Governance Settings State
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [requireSupervisorPinDraft, setRequireSupervisorPinDraft] = useState(false);
  const [blindSettlementDraft, setBlindSettlementDraft] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ['van-settlement-settings'],
    queryFn: () => settingsApi.settings(),
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setRequireSupervisorPinDraft(Boolean(settingsQuery.data.vanSettlementRequireSupervisorPin));
      setBlindSettlementDraft(Boolean(settingsQuery.data.vanSettlementBlindMode));
    }
  }, [settingsQuery.data]);

  const {
    reps,
    isRepsLoading,
    pendingReturns,
    pendingRequisitions,
    suspicionEventsCount,
  } = useVanSalesAdmin();

  const ledgerBadgeQuery = useQuery({
    queryKey: ['van-rep-financial-ledger-badge'],
    queryFn: () => vanSalesApi.getRepFinancialLedger({ status: 'pending' }),
    staleTime: 30_000,
  });
  const pendingShortagesCount = ledgerBadgeQuery.data?.items?.length || 0;

  const vanDrivers = useMemo(() => {
    return reps.filter((r) => r.is_van_rep || r.rep_type === 'van' || r.rep_type === 'both' || !r.rep_type);
  }, [reps]);

  const filteredDrivers = useMemo(() => {
    return vanDrivers.filter((d) => {
      if (driverSearch.trim()) {
        const q = driverSearch.toLowerCase().trim();
        const matchesName = (d.name || '').toLowerCase().includes(q);
        const matchesPhone = (d.phone || '').toLowerCase().includes(q);
        const matchesPlate = (d.vehicle_plate || '').toLowerCase().includes(q);
        return matchesName || matchesPhone || matchesPlate;
      }
      return true;
    });
  }, [vanDrivers, driverSearch]);

  const queryClient = useQueryClient();
  const [isRefreshingDrivers, setIsRefreshingDrivers] = useState(false);

  const handleRefreshDrivers = async () => {
    setIsRefreshingDrivers(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['delivery-reps'] }),
        queryClient.invalidateQueries({ queryKey: ['van-admin-pending-returns-badge'] }),
        queryClient.invalidateQueries({ queryKey: ['van-admin-pending-requisitions-badge'] }),
      ]);
      await new Promise((r) => setTimeout(r, 450));
      toast.success('تم تحديث قائمة مناديب وسائقي الفان بنجاح');
    } catch {
      toast.error('حدث خطأ أثناء تحديث البيانات');
    } finally {
      setIsRefreshingDrivers(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deliveryRepsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-reps'] });
      systemAlert('تم إيقاف حساب المندوب بنجاح');
    },
    onError: (err: any) => {
      systemAlert(err.message || 'حدث خطأ أثناء إيقاف المندوب');
    },
  });

  const copyUrl = (path: string, label: string) => {
    const url = window.location.origin + path;
    navigator.clipboard.writeText(url);
    systemAlert(`تم نسخ رابط ${label} إلى الحافظة:\n${url}`);
  };

  const copyCredentials = (d: DeliveryRep) => {
    const portalUrl = `${window.location.origin}/van-sales`;
    const message = [
      `مرحباً ${d.name}،`,
      `إليك بيانات دخولك لتطبيق مبيعات وتوزيع الفان:`,
      `رابط المنظومة: ${portalUrl}`,
      `رقم الهاتف: ${d.phone || 'غير مسجل'}`,
      `رمز الدخول السريع (PIN): الرمز المحدد لك من الإدارة`,
      d.vehicle_plate ? `المركبة المسندة: لوحة (${d.vehicle_plate})` : '',
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(message);
    systemAlert(`تم نسخ بيانات دخول المندوب (${d.name}) إلى الحافظة بنجاح، يمكنك مشاركتها معه الآن.`);
  };

  const handleToggleActive = async (d: DeliveryRep) => {
    if (d.is_active) {
      const confirmed = await systemConfirm({
        title: 'إيقاف حساب المندوب',
        message: `هل أنت متأكد من إيقاف حساب المندوب "${d.name}"؟ لن يتمكن من فتح تطبيق الهاتف حتى يتم تفعيله مجدداً.`,
        confirmText: 'إيقاف الحساب',
        cancelText: 'إلغاء',
        variant: 'danger',
      });
      if (!confirmed) return;
      deleteMutation.mutate(d.id);
    } else {
      try {
        await deliveryRepsApi.update(d.id, {
          name: d.name,
          isActive: true,
        });
        queryClient.invalidateQueries({ queryKey: ['delivery-reps'] });
        systemAlert(`تمت إعادة تفعيل حساب المندوب "${d.name}" بنجاح.`);
      } catch (err: any) {
        systemAlert(err.message || 'حدث خطأ أثناء تفعيل المندوب');
      }
    }
  };

  return (
    <div
      dir="rtl"
      style={{
        maxWidth: '1280px',
        width: 'min(100%, 1280px)',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '16px 0',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <PageHeader
        title={t('delivery_reps.van_sales_admin_management_page.s0', "مركز إدارة سيارات التوزيع وأسطول الفان (Van Sales & Fleet)")}
        description={t('delivery_reps.van_sales_admin_management_page.s1', "المنظومة المؤسسية لإدارة سيارات التوزيع، ورديات البيع الميداني، وجرد المستودعات المتنقلة")}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Button
              variant="secondary"
              onClick={() => setIsSettingsModalOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 700,
                fontSize: '12.5px',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                color: '#1e293b',
              }}
            >
              <SlidersIcon size={15} color="#170e5e" />
              {t('delivery_reps.van_sales_admin_management_page.s2', "إعدادات التصفية والرقابة")}
            </Button>
            {activeTab === 'drivers' && (
              <Button
                variant="primary"
                style={{ background: '#170e5e', color: '#ffffff', fontWeight: 700, fontSize: '13px' }}
                onClick={() => {
                  setEditingRep(null);
                  setIsUpsertRepOpen(true);
                }}
              >
                {t('delivery_reps.van_sales_admin_management_page.s3', "+ إضافة مندوب فان جديد")}
              </Button>
            )}
          </div>
        }
      />

      {/* Navigation Tabs - 2 Premium Balanced Rows (6 tabs each, Zero Font Shift, Zero Flickering) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          background: '#ffffff',
          padding: '8px',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {/* Row 1: Core Field Operations, Cash/Stock Ledgers & Requisitions */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
            gap: '6px',
            width: '100%',
          }}
        >
          {[
            {
              key: 'trips' as const,
              label: t('delivery_reps.van_sales_admin_management_page.s4', "رحلات التوزيع"),
              icon: <SlidersIcon size={14} />,
            },
            {
              key: 'financial_ledger' as const,
              label: t('delivery_reps.van_sales_admin_management_page.s5', "تسويات وحسابات المناديب"),
              count: pendingShortagesCount > 0 ? pendingShortagesCount : undefined,
              badgeBg: '#fee2e2',
              badgeColor: '#dc2626',
              icon: <CreditCardIcon size={14} />,
            },
            {
              key: 'requisitions' as const,
              label: t('delivery_reps.van_sales_admin_management_page.s6', "أذونات التحميل"),
              count: pendingRequisitions.length > 0 ? pendingRequisitions.length : undefined,
              badgeBg: '#fef3c7',
              badgeColor: '#b45309',
              icon: <TruckIcon size={14} />,
            },
            {
              key: 'presales' as const,
              label: t('delivery_reps.van_sales_admin_management_page.s7', "طلبيات وحجوزات الميدان"),
              icon: <FileTextIcon size={14} />,
            },
            {
              key: 'returns' as const,
              label: t('delivery_reps.van_sales_admin_management_page.s8', "مرتجعات الميدان"),
              count: pendingReturns.length > 0 ? pendingReturns.length : undefined,
              badgeBg: '#fee2e2',
              badgeColor: '#b91c1c',
              icon: <FileTextIcon size={14} />,
            },
            {
              key: 'routes_kpis' as const,
              label: t('delivery_reps.van_sales_admin_management_page.s9', "خطوط السير والرقابة"),
              icon: <MapPinIcon size={14} />,
            },
          ].map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActiveTab(tab.key);
                  setSearchParams({ tab: tab.key });
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  height: '36px',
                  padding: '0 8px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: isActive ? '1px solid #170e5e' : '1px solid #e2e8f0',
                  background: isActive ? '#170e5e' : '#f8fafc',
                  color: isActive ? '#ffffff' : '#334155',
                  cursor: 'pointer',
                  transition: 'none',
                  boxSizing: 'border-box',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = '#f1f5f9';
                    e.currentTarget.style.borderColor = '#cbd5e1';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = '#f8fafc';
                    e.currentTarget.style.borderColor = '#e2e8f0';
                  }
                }}
              >
                <span style={{ display: 'inline-flex', flexShrink: 0, opacity: isActive ? 1 : 0.85 }}>
                  {tab.icon}
                </span>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.label}
                </span>
                {tab.count !== undefined && (
                  <span
                    style={{
                      flexShrink: 0,
                      background: isActive
                        ? 'rgba(255,255,255,0.22)'
                        : tab.badgeBg || '#e2e8f0',
                      color: isActive ? '#ffffff' : tab.badgeColor || '#475569',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: '10px',
                      minWidth: '16px',
                      textAlign: 'center',
                      lineHeight: '15px',
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Subtle Row Separator */}
        <div style={{ height: '1px', backgroundColor: '#f1f5f9', margin: '1px 2px' }} />

        {/* Row 2: Governance, Commercial, Tracking & Fleet */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
            gap: '6px',
            width: '100%',
          }}
        >
          {[
            {
              key: 'radar' as const,
              label: t('delivery_reps.van_sales_admin_management_page.s10', "رادار الشبهات والأمان"),
              count: suspicionEventsCount > 0 ? suspicionEventsCount : undefined,
              badgeBg: '#fee2e2',
              badgeColor: '#dc2626',
              icon: <CheckShieldIcon size={14} />,
            },
            {
              key: 'visits_tracking' as const,
              label: t('delivery_reps.van_sales_admin_management_page.s11', "التتبع والميدان Live"),
              icon: <MapPinIcon size={14} />,
            },
            {
              key: 'targets' as const,
              label: t('delivery_reps.van_sales_admin_management_page.s12', "مستهدفات البيع والتارجت"),
              icon: <CheckCircleIcon size={14} />,
            },
            {
              key: 'promotions' as const,
              label: t('delivery_reps.van_sales_admin_management_page.s13', "عروض وخلطات الأسعار"),
              icon: <SlidersIcon size={14} />,
            },
            {
              key: 'fleet' as const,
              label: t('delivery_reps.van_sales_admin_management_page.s14', "أسطول وسيارات الفان"),
              icon: <TruckIcon size={14} />,
            },
            {
              key: 'drivers' as const,
              label: t('delivery_reps.van_sales_admin_management_page.s15', "بيانات مناديب التوزيع"),
              count: vanDrivers.length,
              badgeBg: '#e2e8f0',
              badgeColor: '#334155',
              icon: <UsersIcon size={14} />,
            },
          ].map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActiveTab(tab.key);
                  setSearchParams({ tab: tab.key });
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  height: '36px',
                  padding: '0 8px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: isActive ? '1px solid #170e5e' : '1px solid #e2e8f0',
                  background: isActive ? '#170e5e' : '#f8fafc',
                  color: isActive ? '#ffffff' : '#334155',
                  cursor: 'pointer',
                  transition: 'none',
                  boxSizing: 'border-box',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = '#f1f5f9';
                    e.currentTarget.style.borderColor = '#cbd5e1';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = '#f8fafc';
                    e.currentTarget.style.borderColor = '#e2e8f0';
                  }
                }}
              >
                <span style={{ display: 'inline-flex', flexShrink: 0, opacity: isActive ? 1 : 0.85 }}>
                  {tab.icon}
                </span>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.label}
                </span>
                {tab.count !== undefined && (
                  <span
                    style={{
                      flexShrink: 0,
                      background: isActive
                        ? 'rgba(255,255,255,0.22)'
                        : tab.badgeBg || '#e2e8f0',
                      color: isActive ? '#ffffff' : tab.badgeColor || '#475569',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: '10px',
                      minWidth: '16px',
                      textAlign: 'center',
                      lineHeight: '15px',
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab 1: Trips */}
      {activeTab === 'trips' && <VanTripsTab />}

      {/* Tab: Rep Financial Ledger & Settlements Hub */}
      {activeTab === 'financial_ledger' && <VanFinancialLedgerAdminTab />}

      {/* Tab 2: Requisitions */}
      {activeTab === 'requisitions' && <VanLoadRequisitionsAdminTab />}

      {/* Tab: Pre-Sales Orders & Bookings */}
      {activeTab === 'presales' && <VanPreSalesAdminTab reps={vanDrivers.map((d) => ({ id: d.id, name: d.name }))} />}

      {/* Tab: Routes & Field Supervision KPIs */}
      {activeTab === 'routes_kpis' && <VanRoutesKpiAdminTab />}

      {/* Tab 3: Returns */}
      {activeTab === 'returns' && <VanFieldReturnsAdminTab />}

      {/* Tab: Anti-Theft & Suspicion Radar */}
      {activeTab === 'radar' && <VanFraudRadarAdminTab />}

      {/* Tab 4: Targets */}
      {activeTab === 'targets' && <VanRepTargetsAdminTab />}

      {/* Tab: FMCG Mix & Match Promotions */}
      {activeTab === 'promotions' && <VanPromotionsAdminTab />}

      {/* Tab: FMCG Visits, Strike Rate & Breadcrumbs Live Tracking */}
      {activeTab === 'visits_tracking' && <VanVisitsTrackingAdminTab />}

      {/* Tab 5: Fleet */}
      {activeTab === 'fleet' && <FleetVehiclesTab />}

      {/* Tab 6: Drivers */}
      {activeTab === 'drivers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Info Banner */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '14px 18px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '8px',
                  background: '#f0f9ff',
                  color: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <UsersIcon size={20} color="#0284c7" />
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                  {t('delivery_reps.van_sales_admin_management_page.s16', "سائقي ومناديب التوزيع الميداني (Van Drivers)")}
                </h4>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  {t('delivery_reps.van_sales_admin_management_page.s17', "تسجيل بيانات المناديب، ربطهم بسيارات التوزيع، وتفعيل بوابة البيع الميداني (/van-sales) برمز PIN.")}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              <Button
                variant="secondary"
                style={{ fontSize: '12px', padding: '6px 12px' }}
                onClick={() => copyUrl('/van-sales', t('delivery_reps.van_sales_admin_management_page.s18', "بوابة مبيعات الفان"))}
              >
                <CopyIcon size={12} /> {t('delivery_reps.van_sales_admin_management_page.s19', "نسخ رابط البوابة (/van-sales)")}
              </Button>
              <Button
                variant="secondary"
                style={{ fontSize: '12px', padding: '6px 12px', background: '#170e5e', color: '#ffffff', borderColor: '#170e5e' }}
                onClick={() => window.open('/van-sales', '_blank')}
              >
                {t('delivery_reps.van_sales_admin_management_page.s20', "فتح البوابة ↗")}
              </Button>
            </div>
          </div>

          {/* Filter Bar */}
          <div
            style={{
              background: '#ffffff',
              padding: '12px 16px',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div style={{ position: 'relative', flex: '1', minWidth: '240px' }}>
              <input
                type="text"
                placeholder={t('delivery_reps.van_sales_admin_management_page.s21', "بحث باسم المندوب أو رقم الهاتف أو لوحة السيارة...")}
                value={driverSearch}
                onChange={(e) => setDriverSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px 8px 36px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
              <span style={{ position: 'absolute', left: '10px', top: '10px', color: '#94a3b8' }}>
                <SearchIcon size={16} />
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>
                {t('delivery_reps.van_sales_admin_management_page.s22', "مناديب الفان المسجلين:")} {vanDrivers.length}
              </span>
              <Button
                variant="secondary"
                disabled={isRefreshingDrivers}
                style={{
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: isRefreshingDrivers ? 'wait' : 'pointer',
                  opacity: isRefreshingDrivers ? 0.75 : 1,
                }}
                onClick={handleRefreshDrivers}
                title={t('delivery_reps.van_sales_admin_management_page.s23', "تحديث قائمة المناديب من السيرفر")}
              >
                <RefreshCwIcon
                  size={13}
                  className={isRefreshingDrivers ? 'spin-animation' : undefined}
                  style={isRefreshingDrivers ? { animation: 'spin 0.75s linear infinite' } : undefined}
                />
                {isRefreshingDrivers ? t('delivery_reps.van_sales_admin_management_page.s24', "جارٍ التحديث...") : t('delivery_reps.van_sales_admin_management_page.s25', "تحديث")}
              </Button>
            </div>
          </div>

          {/* Drivers Table */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              overflowX: 'auto',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            }}
          >
            {isRepsLoading ? (
              <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontWeight: 700 }}>
                {t('delivery_reps.van_sales_admin_management_page.s26', "جاري تحميل بيانات المناديب...")}
              </div>
            ) : filteredDrivers.length === 0 ? (
              <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontWeight: 600 }}>
                {t('delivery_reps.van_sales_admin_management_page.s27', "لا يوجد مناديب توزيع فان مسجلين حالياً. انقر على \"+ إضافة مندوب فان جديد\" لإنشاء حساب ميداني.")}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.van_sales_admin_management_page.s28', "اسم المندوب")}</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.van_sales_admin_management_page.s29', "نوع التكليف")}</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.van_sales_admin_management_page.s30', "رقم الهاتف")}</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.van_sales_admin_management_page.s31', "المركبة الحالية")}</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.van_sales_admin_management_page.s32', "رمز الدخول (PIN)")}</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.van_sales_admin_management_page.s33', "الحالة")}</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_sales_admin_management_page.s34', "الإجراءات")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDrivers.map((d) => {
                    const isBoth = d.rep_type === 'both';
                    return (
                      <tr key={d.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13.5px' }}>{d.name}</div>
                          {d.full_name && (
                            <div style={{ fontSize: '11px', color: '#64748b' }}>{d.full_name}</div>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          {isBoth ? (
                            <span style={{ fontSize: '11px', color: '#6d28d9', background: '#ede9fe', padding: '2px 8px', borderRadius: '6px', border: '1px solid #ddd6fe', fontWeight: 700 }}>
                              {t('delivery_reps.van_sales_admin_management_page.s35', "شامل (فان ودليفري)")}
                            </span>
                          ) : (
                            <span style={{ fontSize: '11px', color: '#0369a1', background: '#e0f2fe', padding: '2px 8px', borderRadius: '6px', border: '1px solid #bae6fd', fontWeight: 700 }}>
                              {t('delivery_reps.van_sales_admin_management_page.s36', "توزيع فان حصري")}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', direction: 'ltr', textAlign: 'right', fontFamily: 'monospace', fontSize: '12px' }}>
                          {d.phone || <span style={{ color: '#dc2626' }}>{t('delivery_reps.van_sales_admin_management_page.s37', "غير مسجل")}</span>}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          {d.vehicle_plate ? (
                            <span style={{ fontSize: '11px', background: '#f1f5f9', color: '#334155', padding: '2px 7px', borderRadius: '4px', border: '1px solid #e2e8f0', fontWeight: 700 }}>
                              {t('delivery_reps.van_sales_admin_management_page.s38', "لوحة:")} {d.vehicle_plate}
                            </span>
                          ) : (
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>{t('delivery_reps.van_sales_admin_management_page.s39', "بدون لوحة مسندة")}</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          {(() => {
                            const hasPin = Boolean(d.has_pin || (d as any).hasPin || (d as any).pin_hash || d.pin_code);
                            return (
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '2px 8px',
                                  background: hasPin ? '#ecfdf5' : '#fef2f2',
                                  border: `1px solid ${hasPin ? '#a7f3d0' : '#fecaca'}`,
                                  color: hasPin ? '#065f46' : '#b91c1c',
                                  borderRadius: '6px',
                                  fontFamily: 'monospace',
                                  fontWeight: 700,
                                  fontSize: '11.5px',
                                }}
                              >
                                {hasPin ? t('delivery_reps.van_sales_admin_management_page.s40', "•••• مفعل") : t('delivery_reps.van_sales_admin_management_page.s41', "بدون رمز")}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: d.is_active ? '#ecfdf5' : '#fef2f2',
                              color: d.is_active ? '#065f46' : '#991b1b',
                              border: `1px solid ${d.is_active ? '#a7f3d0' : '#fecaca'}`,
                            }}
                          >
                            {d.is_active ? t('delivery_reps.van_sales_admin_management_page.s42', "نشط") : t('delivery_reps.van_sales_admin_management_page.s43', "موقوف")}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                            <Button
                              variant="secondary"
                              style={{ fontSize: '11px', padding: '4px 10px', fontWeight: 600 }}
                              onClick={() => {
                                setEditingRep(d);
                                setIsUpsertRepOpen(true);
                              }}
                            >
                              {t('delivery_reps.van_sales_admin_management_page.s44', "تعديل البيانات")}
                            </Button>
                            <Button
                              variant="secondary"
                              title={t('delivery_reps.van_sales_admin_management_page.s45', "نسخ بيانات الدخول لإرسالها للمندوب عبر الواتساب")}
                              style={{ fontSize: '11px', padding: '4px 8px', background: '#f8fafc', color: '#1e293b' }}
                              onClick={() => copyCredentials(d)}
                            >
                              <CopyIcon size={12} /> {t('delivery_reps.van_sales_admin_management_page.s46', "نسخ بيانات الدخول")}
                            </Button>
                            <Button
                              variant="secondary"
                              style={{
                                fontSize: '11px',
                                padding: '4px 8px',
                                background: d.is_active ? '#fff1f2' : '#f0fdf4',
                                color: d.is_active ? '#b91c1c' : '#15803d',
                                border: `1px solid ${d.is_active ? '#fecdd3' : '#bbf7d0'}`,
                                fontWeight: 700,
                              }}
                              onClick={() => handleToggleActive(d)}
                            >
                              {d.is_active ? t('delivery_reps.van_sales_admin_management_page.s47', "إيقاف") : t('delivery_reps.van_sales_admin_management_page.s48', "تفعيل")}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <UpsertDeliveryRepModal
        open={isUpsertRepOpen}
        onClose={() => {
          setIsUpsertRepOpen(false);
          setEditingRep(null);
        }}
        rep={editingRep}
        defaultRepType="van"
        hideDeliveryOption={true}
      />

      {/* Quick Van Settlement & Governance Settings Modal */}
      {isSettingsModalOpen && (
        <StandardDialog
          open={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          title={t('delivery_reps.van_sales_admin_management_page.s49', "إعدادات الرقابة وتصفية رحلات الفان")}
          subtitle={t('delivery_reps.van_sales_admin_management_page.s50', "التحكم في اشتراط رمز المشرف (PIN) لتصفية ورديات المناديب والرمز السري المعتمد")}
          width="540px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '4px 0' }} dir="rtl">
            {/* Setting 1: Require Supervisor PIN Toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                backgroundColor: '#f8fafc',
                gap: '12px',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', marginBottom: '3px' }}>
                  {t('delivery_reps.van_sales_admin_management_page.s51', "إلزامية رمز المشرف (PIN) لتصفية الوردية")}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.5 }}>
                  {requireSupervisorPinDraft
                    ? t('delivery_reps.van_sales_admin_management_page.s52', "مفعل: يلزم إدخال رمز المشرف (PIN) على هاتف المندوب لإبراء ذمته واستلام الكاش.")
                    : t('delivery_reps.van_sales_admin_management_page.s53', "معطل: يقفل المندوب ورديته مباشرة وتتم مراجعة واستلام النقدية من لوحة الإدارة.")}
                </div>
              </div>
              <input
                type="checkbox"
                checked={requireSupervisorPinDraft}
                onChange={(e) => setRequireSupervisorPinDraft(e.target.checked)}
                style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#170e5e', marginTop: '2px' }}
              />
            </div>

            {/* Setting 1.5: Blind Settlement Mode */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 14px',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                backgroundColor: '#f8fafc',
                gap: '12px',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', marginBottom: '3px' }}>
                  {t('delivery_reps.van_sales_admin_management_page.s54', "إلزام التوريد والجرد العمياني (Blind Cash Settlement)")}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.5 }}>
                  {blindSettlementDraft
                    ? t('delivery_reps.van_sales_admin_management_page.s55', "مفعل: إخفاء صافي النقدية المتوقعة وزر المطابقة؛ يُلزم المندوب بعدّ الكاش الفعلي واحتساب الفروقات رقابياً بالخزينة.")
                    : t('delivery_reps.van_sales_admin_management_page.s56', "معطل: يظهر صافي النقدية المتوقعة وزر المطابقة أمام المندوب بشفافية لتسريع التصفية.")}
                </div>
              </div>
              <input
                type="checkbox"
                checked={blindSettlementDraft}
                onChange={(e) => setBlindSettlementDraft(e.target.checked)}
                style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#170e5e', marginTop: '2px' }}
              />
            </div>

            {/* Manager Approval PIN: single place is Settings > Security.
                This modal no longer edits it; it only points there. */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '12px 14px',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                backgroundColor: '#ffffff',
              }}
            >
              <label style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                {t('delivery_reps.van_sales_admin_management_page.s57', "رمز اعتماد المدير (Manager Approval PIN):")}
              </label>
              <div style={{ fontSize: '10.5px', color: '#64748b' }}>
                {t('delivery_reps.van_sales_admin_management_page.s58', "يستخدم لاعتماد التصفية الميدانية أو تجاوز سقف الائتمان الاستثنائي، ويتم ضبطه من مكان واحد فقط: الإعدادات > الأمان والنسخ الاحتياطي > رمز اعتماد المدير.")}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <Button
                variant="secondary"
                onClick={() => setIsSettingsModalOpen(false)}
                disabled={isSavingSettings}
              >
                {t('delivery_reps.van_sales_admin_management_page.s60', "إلغاء")}
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  setIsSavingSettings(true);
                  try {
                    await settingsApi.update({
                      vanSettlementRequireSupervisorPin: requireSupervisorPinDraft,
                      vanSettlementBlindMode: blindSettlementDraft,
                    });
                    await queryClient.invalidateQueries({ queryKey: ['van-settlement-settings'] });
                    await queryClient.invalidateQueries({ queryKey: ['van-sales-active-trip'] });
                    toast.success(t('delivery_reps.van_sales_admin_management_page.s61', "تم حفظ إعدادات تصفية الفان والرقابة بنجاح"));
                    setIsSettingsModalOpen(false);
                  } catch (err: any) {
                    toast.error(err?.message || t('delivery_reps.van_sales_admin_management_page.s62', "حدث خطأ أثناء حفظ الإعدادات"));
                  } finally {
                    setIsSavingSettings(false);
                  }
                }}
                disabled={isSavingSettings}
                style={{ backgroundColor: '#170e5e', color: '#ffffff', fontWeight: 800 }}
              >
                {isSavingSettings ? t('delivery_reps.van_sales_admin_management_page.s63', "جاري الحفظ...") : t('delivery_reps.van_sales_admin_management_page.s64', "حفظ الإعدادات")}
              </Button>
            </div>
          </div>
        </StandardDialog>
      )}
    </div>
  );
}
