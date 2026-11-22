import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/shared/components/system-alert';
import { deliveryRepsApi, DeliveryRep } from '@/shared/api/delivery-reps.api';
import {
  vanSalesApi,
  SupervisorRouteKpiSummary,
  InterVanTransferRecord,
  SupervisorCustomerRouteItem,
} from '../api/van-sales.api';
import { normalizeDayKey } from './VanItineraryTab';
import { RoutesKpiDateFilters } from './van-routes-kpi/routes-kpi-date-filters';
import { RoutesKpiHighlights } from './van-routes-kpi/routes-kpi-highlights';
import { RoutesKpiNegativeAlert } from './van-routes-kpi/routes-kpi-negative-alert';
import { RoutesKpiSectionTabs } from './van-routes-kpi/routes-kpi-section-tabs';
import { RoutesKpiTransfers } from './van-routes-kpi/routes-kpi-transfers';
import { RoutesKpiVisits } from './van-routes-kpi/routes-kpi-visits';
import { RoutesKpiScheduling } from './van-routes-kpi/routes-kpi-scheduling';
import { RoutesKpiEditModal } from './van-routes-kpi/routes-kpi-edit-modal';
import { RoutesKpiBulkModal } from './van-routes-kpi/routes-kpi-bulk-modal';



export function VanRoutesKpiAdminTab() {
  const queryClient = useQueryClient();

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activeSection, setActiveSection] = useState<'transfers' | 'visits' | 'scheduling'>('transfers');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 1. Supervisor KPIs Query
  const { data: kpiData, refetch: refetchKpis } = useQuery<SupervisorRouteKpiSummary>({
    queryKey: ['van-supervisor-kpis', dateFrom, dateTo],
    queryFn: () => vanSalesApi.fetchSupervisorRouteKpis({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
    refetchInterval: 30000,
  });

  // 2. Inter-Van Transfers Live Ribbon Query
  const { data: transfers = [], isLoading: isTransfersLoading, refetch: refetchTransfers } = useQuery<InterVanTransferRecord[]>({
    queryKey: ['van-admin-transfers'],
    queryFn: () => vanSalesApi.fetchAdminTransfers(),
    refetchInterval: 15000,
  });

  // 3. Field Visits Query
  const { data: fieldVisits = [], isLoading: isVisitsLoading, refetch: refetchVisits } = useQuery<any[]>({
    queryKey: ['van-admin-field-visits', dateFrom, dateTo],
    queryFn: () => vanSalesApi.fetchAdminFieldVisits({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
    refetchInterval: 25000,
  });

  // 4. Van Delivery Representatives Query
  const { data: allReps = [] } = useQuery<DeliveryRep[]>({
    queryKey: ['delivery-reps'],
    queryFn: () => deliveryRepsApi.list(),
  });

  const vanReps = useMemo(() => {
    return allReps.filter((r) => r.is_active && (r.is_van_rep || r.rep_type === 'van' || r.rep_type === 'both' || !r.rep_type));
  }, [allReps]);

  // Section 3: Route & Rep Scheduling Filters & Data
  const [repFilter, setRepFilter] = useState<'all' | 'unassigned' | string>('all');
  const [routeFilter, setRouteFilter] = useState<'all' | string>('all');
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<number[]>([]);
  const [isOptimizingRoute, setIsOptimizingRoute] = useState(false);

  const handleOptimizeSupervisorRoute = async () => {
    if (routeFilter === 'all') return;
    try {
      setIsOptimizingRoute(true);
      const res = await vanSalesApi.optimizeSupervisorRoute({
        route: routeFilter,
        persistSequence: true,
      });

      if (res && res.stats) {
        toast.success(
          `تم ترتيب خط «${routeFilter}» جغرافياً بنجاح! توفير ${res.stats.savedDistanceKm} كم (${res.stats.savingsPercent}%) وتحديث تسلسل ${res.persistedCount || res.orderedStops.length} عميل.`,
        );
        refetchCustomerRoutes();
      }
    } catch (err: any) {
      toast.error(err?.message || 'حدث خطأ أثناء تحسين مسار خط السير');
    } finally {
      setIsOptimizingRoute(false);
    }
  };

  // 5. Supervisor Customer Routes Query (Full Customer Base from Dedicated API)
  const {
    data: customerRoutes = [],
    isLoading: isRoutesLoading,
    refetch: refetchCustomerRoutes,
  } = useQuery<SupervisorCustomerRouteItem[]>({
    queryKey: ['van-supervisor-customer-routes', customerSearch, repFilter, routeFilter],
    queryFn: () =>
      vanSalesApi.getSupervisorCustomerRoutes({
        search: customerSearch.trim() || undefined,
        repId: repFilter !== 'all' ? repFilter : undefined,
        route: routeFilter !== 'all' ? routeFilter : undefined,
        unassignedOnly: repFilter === 'unassigned',
      }),
    staleTime: 30000,
  });

  const availableRoutes = useMemo(() => {
    const set = new Set<string>();
    customerRoutes.forEach((c) => {
      if (c.route && c.route !== 'غير محدد') set.add(c.route);
    });
    return Array.from(set).sort();
  }, [customerRoutes]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['van-supervisor-kpis'] }),
        queryClient.invalidateQueries({ queryKey: ['van-admin-transfers'] }),
        queryClient.invalidateQueries({ queryKey: ['van-admin-field-visits'] }),
        queryClient.invalidateQueries({ queryKey: ['van-supervisor-customer-routes'] }),
        queryClient.invalidateQueries({ queryKey: ['delivery-reps'] }),
        refetchKpis(),
        refetchTransfers(),
        refetchVisits(),
        refetchCustomerRoutes(),
      ]);
      await new Promise((r) => setTimeout(r, 450));
      toast.success('تم تحديث بيانات خطوط السير والرقابة بنجاح');
    } catch {
      toast.error('حدث خطأ أثناء تحديث البيانات');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Single Customer Route & Rep Edit Modal State
  const [editingCustomer, setEditingCustomer] = useState<SupervisorCustomerRouteItem | null>(null);
  const [routeInput, setRouteInput] = useState('');
  const [sequenceInput, setSequenceInput] = useState('1');
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [assignedRepId, setAssignedRepId] = useState<string>('');
  const [assignedRepIds, setAssignedRepIds] = useState<number[]>([]);

  const scheduleMutation = useMutation({
    mutationFn: (payload: {
      customerId: number;
      route: string;
      routeSequence: number;
      visitDays: string[];
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      assignedRepName?: string;
    }) => vanSalesApi.setCustomerRouteSchedule(payload.customerId, payload),
    onSuccess: () => {
      toast.success('تم تحديث وتخصيص خط سير العميل بنجاح');
      setEditingCustomer(null);
      queryClient.invalidateQueries({ queryKey: ['van-supervisor-customer-routes'] });
      queryClient.invalidateQueries({ queryKey: ['van-supervisor-kpis'] });
      queryClient.invalidateQueries({ queryKey: ['driver-itinerary'] });
      queryClient.invalidateQueries({ queryKey: ['van-admin-field-visits'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل تحديث خط سير العميل');
    },
  });

  const openScheduleModal = (customer: SupervisorCustomerRouteItem) => {
    setEditingCustomer(customer);
    setRouteInput(customer.route === 'غير محدد' ? '' : customer.route);
    setSequenceInput(String(customer.routeSequence || 1));
    const initDays = Array.isArray(customer.visitDays) && customer.visitDays.length > 0
      ? customer.visitDays.map((d: string) => normalizeDayKey(d)).filter(Boolean)
      : (customer.visitDay ? [normalizeDayKey(customer.visitDay)].filter(Boolean) : []);
    setSelectedDays(initDays);
    setAssignedRepId(customer.assignedRepId ? String(customer.assignedRepId) : '');
    const initRepIds =
      Array.isArray(customer.assignedRepIds) && customer.assignedRepIds.length > 0
        ? customer.assignedRepIds
        : customer.assignedRepId
          ? [customer.assignedRepId]
          : [];
    setAssignedRepIds(initRepIds);
  };

  const handleToggleRepAssignment = (repIdNum: number) => {
    setAssignedRepIds((prev) => {
      const next = prev.includes(repIdNum) ? prev.filter((id) => id !== repIdNum) : [...prev, repIdNum];
      setAssignedRepId(next.length > 0 ? String(next[0]) : '');
      return next;
    });
  };

  const handleToggleDay = (dayId: string) => {
    setSelectedDays((prev) => (prev.includes(dayId) ? prev.filter((d) => d !== dayId) : [...prev, dayId]));
  };

  // Bulk Customer Assignment Modal State & Mutation
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkRepId, setBulkRepId] = useState<string>('no_change');
  const [bulkRouteInput, setBulkRouteInput] = useState<string>('');
  const [bulkVisitDays, setBulkVisitDays] = useState<string[]>(['saturday', 'monday', 'wednesday']);
  const [bulkApplyDays, setBulkApplyDays] = useState<boolean>(false);

  const bulkAssignMutation = useMutation({
    mutationFn: (payload: {
      customerIds: number[];
      assignedRepId?: number | null;
      assignedRepName?: string;
      route?: string;
      visitDays?: string[];
    }) => vanSalesApi.bulkAssignCustomerRoutes(payload),
    onSuccess: (res) => {
      toast.success(`تم التخصيص الجماعي بنجاح لـ (${res.updatedCount}) متجر/عميل!`);
      setBulkModalOpen(false);
      setSelectedCustomerIds([]);
      queryClient.invalidateQueries({ queryKey: ['van-supervisor-customer-routes'] });
      queryClient.invalidateQueries({ queryKey: ['van-supervisor-kpis'] });
      queryClient.invalidateQueries({ queryKey: ['driver-itinerary'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل التخصيص الجماعي للمحلات');
    },
  });

  const handleToggleBulkDay = (dayId: string) => {
    setBulkVisitDays((prev) => (prev.includes(dayId) ? prev.filter((d) => d !== dayId) : [...prev, dayId]));
  };

  // Selection helpers
  const isAllSelected = customerRoutes.length > 0 && selectedCustomerIds.length === customerRoutes.length;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedCustomerIds([]);
    } else {
      setSelectedCustomerIds(customerRoutes.map((c) => c.customerId));
    }
  };

  const toggleSelectCustomer = (customerId: number) => {
    setSelectedCustomerIds((prev) =>
      prev.includes(customerId) ? prev.filter((id) => id !== customerId) : [...prev, customerId],
    );
  };

  // Repeated negative visits (3+)
  const repeatedNegativeVisits = useMemo(() => {
    return fieldVisits.filter((v) => v.consecutiveNegativeCount >= 3 || v.hasRepeatedNegativeAlert);
  }, [fieldVisits]);

  // Dropdown options for supervisor filters and assignment modals
  const repFilterOptions = useMemo(() => [
    { value: 'all', label: 'جميع المناديب' },
    { value: 'unassigned', label: 'المتاجر غير المخصصة لمندوب' },
    ...vanReps.map((r) => ({
      value: String(r.id),
      label: `${r.name}${r.phone ? ` (${r.phone})` : ''}`,
    })),
  ], [vanReps]);

  const routeFilterOptions = useMemo(() => [
    { value: 'all', label: 'جميع خطوط السير' },
    ...availableRoutes.map((r) => ({
      value: r,
      label: r,
    })),
  ], [availableRoutes]);

  const bulkRepOptions = useMemo(() => [
    { value: 'no_change', label: '— الإبقاء على المندوب الحالي لكل متجر (بدون تغيير) —' },
    { value: 'unassigned', label: 'إلغاء التخصيص (تفريغ المندوب من المحلات المختارة)' },
    ...vanReps.map((r) => ({
      value: String(r.id),
      label: `${r.name}${r.phone ? ` (${r.phone})` : ''}`,
    })),
  ], [vanReps]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
      {/* Date Filters Header */}
      <RoutesKpiDateFilters
        dateFrom={dateFrom}
        setDateFrom={setDateFrom}
        dateTo={dateTo}
        setDateTo={setDateTo}
        isRefreshing={isRefreshing}
        handleManualRefresh={handleManualRefresh}
      />

      {/* KPI Highlights Bar */}
      <RoutesKpiHighlights
        kpiData={kpiData}
      />

      {/* Repeated Negative Visits Alert Box (If any exists) */}
      {(repeatedNegativeVisits.length > 0 || (kpiData?.repeatedNegativeCustomersCount ?? 0) > 0) && (
        <RoutesKpiNegativeAlert
          repeatedNegativeVisits={repeatedNegativeVisits}
        />
      )}

      {/* Sub-Navigation Tabs */}
      <RoutesKpiSectionTabs
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        transfers={transfers}
        fieldVisits={fieldVisits}
        customerRoutes={customerRoutes}
      />

      {/* SECTION 1: Inter-Van Transfers Live Ribbon */}
      {activeSection === 'transfers' && (
        <RoutesKpiTransfers
          transfers={transfers}
          isTransfersLoading={isTransfersLoading}
        />
      )}

      {/* SECTION 2: Visits & Negative Reasons Audit */}
      {activeSection === 'visits' && (
        <RoutesKpiVisits
          fieldVisits={fieldVisits}
          isVisitsLoading={isVisitsLoading}
          kpiData={kpiData}
        />
      )}

      {/* SECTION 3: Customer Route Scheduling & Rep Assignment */}
      {activeSection === 'scheduling' && (
        <RoutesKpiScheduling
          routeFilter={routeFilter}
          handleOptimizeSupervisorRoute={handleOptimizeSupervisorRoute}
          isOptimizingRoute={isOptimizingRoute}
          customerRoutes={customerRoutes}
          customerSearch={customerSearch}
          setCustomerSearch={setCustomerSearch}
          repFilter={repFilter}
          setRepFilter={setRepFilter}
          repFilterOptions={repFilterOptions}
          setRouteFilter={setRouteFilter}
          routeFilterOptions={routeFilterOptions}
          selectedCustomerIds={selectedCustomerIds}
          setBulkRepId={setBulkRepId}
          setBulkRouteInput={setBulkRouteInput}
          setBulkApplyDays={setBulkApplyDays}
          setBulkVisitDays={setBulkVisitDays}
          setBulkModalOpen={setBulkModalOpen}
          setSelectedCustomerIds={setSelectedCustomerIds}
          isRoutesLoading={isRoutesLoading}
          isAllSelected={isAllSelected}
          toggleSelectAll={toggleSelectAll}
          toggleSelectCustomer={toggleSelectCustomer}
          openScheduleModal={openScheduleModal}
        />
      )}

      {/* Edit Customer Route & Rep Modal */}
      {editingCustomer && (
        <RoutesKpiEditModal
          editingCustomer={editingCustomer}
          assignedRepId={assignedRepId}
          assignedRepIds={assignedRepIds}
          routeInput={routeInput}
          setRouteInput={setRouteInput}
          sequenceInput={sequenceInput}
          setSequenceInput={setSequenceInput}
          selectedDays={selectedDays}
          handleToggleDay={handleToggleDay}
          handleToggleRepAssignment={handleToggleRepAssignment}
          setEditingCustomer={setEditingCustomer}
          scheduleMutation={scheduleMutation}
          vanReps={vanReps}
        />
      )}

      {/* Bulk Customer Assignment Modal */}
      {bulkModalOpen && (
        <RoutesKpiBulkModal
          bulkModalOpen={bulkModalOpen}
          setBulkModalOpen={setBulkModalOpen}
          selectedCustomerIds={selectedCustomerIds}
          bulkRepId={bulkRepId}
          setBulkRepId={setBulkRepId}
          bulkRepOptions={bulkRepOptions}
          bulkRouteInput={bulkRouteInput}
          setBulkRouteInput={setBulkRouteInput}
          bulkApplyDays={bulkApplyDays}
          setBulkApplyDays={setBulkApplyDays}
          bulkVisitDays={bulkVisitDays}
          handleToggleBulkDay={handleToggleBulkDay}
          bulkAssignMutation={bulkAssignMutation}
          vanReps={vanReps}
        />
      )}
    </div>
  );
}
