import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '@/features/settings';
import { systemAlert, systemConfirm, toast } from '@/shared/components/system-alert';
import { deliveryRepsApi } from '@/shared/api/delivery-reps.api';
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
import { useHasAnyPermission } from '@/shared/hooks/use-permission';
import { vanSalesApi } from '../api/van-sales.api';
import type { VanAdminTabKey } from './van-admin/van-admin-types';
import { AdminHeader } from './van-admin/admin-header';
import { AdminNavTabs } from './van-admin/admin-nav-tabs';
import { AdminDrivers } from './van-admin/admin-drivers';
import { AdminSettingsDialog } from './van-admin/admin-settings-dialog';


export default function VanSalesAdminManagementPage() {
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
  // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: the ONE tenant-level
  // rep discount cap % (default 5).
  const [discountCapDraft, setDiscountCapDraft] = useState<number>(5);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // F12 (trial problem 15): this console shows every rep's trips,
  // figures, targets, ledger and fraud data plus the van-control
  // settings dialog. A rep login holds 'deliveryReps' only; only a
  // holder of the supervisor-only 'deliveryRepsAdmin' key may render
  // it. The backend denies the same key on every admin endpoint, so
  // this gate is the UI half — the denied page fires no admin query.
  const canManageVanAdmin = useHasAnyPermission('deliveryRepsAdmin');

  const settingsQuery = useQuery({
    queryKey: ['van-settlement-settings'],
    queryFn: () => settingsApi.settings(),
    enabled: canManageVanAdmin,
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setRequireSupervisorPinDraft(Boolean(settingsQuery.data.vanSettlementRequireSupervisorPin));
      setBlindSettlementDraft(Boolean(settingsQuery.data.vanSettlementBlindMode));
      const storedCap = Number(settingsQuery.data.vanRepDiscountCapPercent);
      setDiscountCapDraft(Number.isFinite(storedCap) ? Math.min(100, Math.max(0, storedCap)) : 5);
    }
  }, [settingsQuery.data]);

  const {
    reps,
    isRepsLoading,
    pendingReturns,
    pendingRequisitions,
    suspicionEventsCount,
  } = useVanSalesAdmin(canManageVanAdmin);

  const ledgerBadgeQuery = useQuery({
    queryKey: ['van-rep-financial-ledger-badge'],
    queryFn: () => vanSalesApi.getRepFinancialLedger({ status: 'pending' }),
    staleTime: 30_000,
    enabled: canManageVanAdmin,
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

  // F12: a rep (or anyone without the supervisor key) never sees
  // the console at all — no tabs, no trips of other reps, no
  // settings dialog. The rep's own work lives on the driver pages.
  if (!canManageVanAdmin) {
    return (
      <div
        dir="rtl"
        style={{
          maxWidth: '1280px',
          width: 'min(100%, 1280px)',
          margin: '0 auto',
          padding: '48px 16px',
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      >
        <strong style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
          هذه الشاشة للمشرف فقط
        </strong>
        <p style={{ color: '#64748b', marginTop: '8px' }}>
          إدارة الفان (رحلات كل المناديب والإعدادات) تحتاج صلاحية إشراف الفان. شاشة المندوب الخاصة بك هي شاشة البيع الميداني.
        </p>
      </div>
    );
  }

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
      <AdminHeader
        activeTab={activeTab}
        setEditingRep={setEditingRep}
        setIsSettingsModalOpen={setIsSettingsModalOpen}
        setIsUpsertRepOpen={setIsUpsertRepOpen}
      />

      {/* Navigation Tabs - 2 Premium Balanced Rows (6 tabs each, Zero Font Shift, Zero Flickering) */}
      <AdminNavTabs
        activeTab={activeTab}
        pendingRequisitions={pendingRequisitions}
        pendingReturns={pendingReturns}
        pendingShortagesCount={pendingShortagesCount}
        setActiveTab={setActiveTab}
        setSearchParams={setSearchParams}
        suspicionEventsCount={suspicionEventsCount}
        vanDrivers={vanDrivers}
      />

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
        <AdminDrivers
          copyCredentials={copyCredentials}
          copyUrl={copyUrl}
          driverSearch={driverSearch}
          filteredDrivers={filteredDrivers}
          handleRefreshDrivers={handleRefreshDrivers}
          handleToggleActive={handleToggleActive}
          isRefreshingDrivers={isRefreshingDrivers}
          isRepsLoading={isRepsLoading}
          setDriverSearch={setDriverSearch}
          setEditingRep={setEditingRep}
          setIsUpsertRepOpen={setIsUpsertRepOpen}
          vanDrivers={vanDrivers}
        />
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
        <AdminSettingsDialog
          blindSettlementDraft={blindSettlementDraft}
          discountCapDraft={discountCapDraft}
          isSavingSettings={isSavingSettings}
          isSettingsModalOpen={isSettingsModalOpen}
          requireSupervisorPinDraft={requireSupervisorPinDraft}
          setBlindSettlementDraft={setBlindSettlementDraft}
          setDiscountCapDraft={setDiscountCapDraft}
          setIsSavingSettings={setIsSavingSettings}
          setIsSettingsModalOpen={setIsSettingsModalOpen}
          setRequireSupervisorPinDraft={setRequireSupervisorPinDraft}
        />
      )}
    </div>
  );
}
