import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vanSalesApi } from '../api/van-sales.api';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import {
  CheckCircleIcon,
  ClockIcon,
  MapPinIcon,
  RefreshCwIcon,
  CheckShieldIcon,
  AlertTriangleIcon,
} from '@/shared/components/icons/AppIcons';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { todayLocalDateKey } from '@/lib/format';

export const VanVisitsTrackingAdminTab: React.FC = () => {
  const { t: __t } = useTranslation();
  const [selectedSubTab, setSelectedSubTab] = useState<'visits' | 'surveys' | 'breadcrumbs'>('visits');
  const [filterDate, setFilterDate] = useState(() => todayLocalDateKey());
  const [filterNoSaleOnly, setFilterNoSaleOnly] = useState(false);
  const [selectedTripIdForTrail, setSelectedTripIdForTrail] = useState<number | null>(null);
  const [focusedPointIndex, setFocusedPointIndex] = useState<number | null>(null);
  const [selectedInventoryVisit, setSelectedInventoryVisit] = useState<any | null>(null);

  // 0. Fetch Admin Trips for automatic trip selection & breadcrumbs dropdown
  const { data: adminTrips = [] } = useQuery({
    queryKey: ['van-sales-admin-trips'],
    queryFn: () => vanSalesApi.listAdminTrips(),
  });

  useEffect(() => {
    if (!selectedTripIdForTrail && adminTrips.length > 0) {
      const activeOrLatest = adminTrips.find((t) => t.status === 'open') || adminTrips[0];
      if (activeOrLatest) {
        setSelectedTripIdForTrail(activeOrLatest.id);
      }
    }
  }, [adminTrips, selectedTripIdForTrail]);

  // 1. Fetch Visits History & Strike Rate KPIs
  const {
    data: visitsData,
    isLoading: isVisitsLoading,
    refetch: refetchVisits,
  } = useQuery({
    queryKey: ['van-admin-visits', filterDate, filterNoSaleOnly],
    queryFn: () => vanSalesApi.getVisitsHistory({ date: filterDate, noSaleOnly: filterNoSaleOnly }),
  });

  // 2. Fetch Trade Surveys
  const {
    data: surveysData,
    isLoading: isSurveysLoading,
    refetch: refetchSurveys,
  } = useQuery({
    queryKey: ['van-admin-trade-surveys'],
    queryFn: () => vanSalesApi.getTradeSurveys(),
  });

  // 3. Fetch Breadcrumbs for selected trip
  const {
    data: breadcrumbsData,
    isLoading: isBreadcrumbsLoading,
  } = useQuery({
    queryKey: ['van-admin-trip-breadcrumbs', selectedTripIdForTrail],
    queryFn: () => (selectedTripIdForTrail ? vanSalesApi.getLiveTripBreadcrumbs(selectedTripIdForTrail) : null),
    enabled: Boolean(selectedTripIdForTrail),
  });

  const metrics = visitsData?.metrics || {
    totalVisits: 0,
    productiveVisits: 0,
    nonProductiveVisits: 0,
    strikeRatePercentage: 0,
    totalSalesAmount: 0,
    totalCollectionsAmount: 0,
    avgDwellTimeMinutes: 0,
    noSaleReasonsCount: {},
  };

  const visits = visitsData?.visits || [];
  const surveys = surveysData?.surveys || [];
  const breadcrumbs = breadcrumbsData?.breadcrumbs || [];

  return (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* KPI Ribbons */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
        }}
      >
        {/* KPI 1: Strike Rate */}
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            padding: '14px 16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s0', __t('delivery_reps.van_visits_tracking_admin_tab.s0', "معدل ضرب الزيارات (Strike Rate)"))}</span>
            <div style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircleIcon size={15} color="#170e5e" />
            </div>
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#170e5e' }}>
            {metrics.strikeRatePercentage}%
          </div>
          <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600, marginTop: '2px' }}>
            {metrics.productiveVisits} {__t('delivery_reps.van_visits_tracking_admin_tab.s1', __t('delivery_reps.van_visits_tracking_admin_tab.s1', "زيارة ببيع من أصل"))} {metrics.totalVisits}
          </div>
        </div>

        {/* KPI 2: Total Visits */}
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            padding: '14px 16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s2', __t('delivery_reps.van_visits_tracking_admin_tab.s2', "إجمالي الزيارات الميدانية"))}</span>
            <div style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MapPinIcon size={15} color="#16a34a" />
            </div>
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
            {metrics.totalVisits}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            {metrics.nonProductiveVisits} {__t('delivery_reps.van_visits_tracking_admin_tab.s3', __t('delivery_reps.van_visits_tracking_admin_tab.s3', "محطة لم تشترِ (سلبية)"))}
          </div>
        </div>

        {/* KPI 3: Total Sales */}
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            padding: '14px 16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s4', __t('delivery_reps.van_visits_tracking_admin_tab.s4', "مبيعات الزيارات المنفذة"))}</span>
            <div style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckShieldIcon size={15} color="#059669" />
            </div>
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#059669' }}>
            {metrics.totalSalesAmount.toLocaleString('en-US')} <span style={{ fontSize: '13px' }}><CurrencySymbol /></span>
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            {__t('delivery_reps.van_visits_tracking_admin_tab.s5', __t('delivery_reps.van_visits_tracking_admin_tab.s5', "تحصيلات:"))} {metrics.totalCollectionsAmount.toLocaleString('en-US')} <CurrencySymbol />
          </div>
        </div>

        {/* KPI 4: Average Dwell Time */}
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            padding: '14px 16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s6', __t('delivery_reps.van_visits_tracking_admin_tab.s6', "متوسط وقت الزيارة بالمحل"))}</span>
            <div style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ClockIcon size={15} color="#d97706" />
            </div>
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#d97706' }}>
            {metrics.avgDwellTimeMinutes} <span style={{ fontSize: '13px' }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s7', __t('delivery_reps.van_visits_tracking_admin_tab.s7', "دقيقة"))}</span>
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            {__t('delivery_reps.van_visits_tracking_admin_tab.s8', __t('delivery_reps.van_visits_tracking_admin_tab.s8', "من تسجيل الـ Check-In للمغادرة"))}
          </div>
        </div>
      </div>

      {/* Sub-Tabs Switcher */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '8px 12px',
        }}
      >
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            onClick={() => setSelectedSubTab('visits')}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: selectedSubTab === 'visits' ? '1px solid #170e5e' : '1px solid transparent',
              backgroundColor: selectedSubTab === 'visits' ? '#170e5e' : 'transparent',
              color: selectedSubTab === 'visits' ? '#ffffff' : '#475569',
              fontWeight: 600,
              fontSize: '12.5px',
              cursor: 'pointer',
            }}
          >
            {__t('delivery_reps.van_visits_tracking_admin_tab.s9', __t('delivery_reps.van_visits_tracking_admin_tab.s9', "سجل الزيارات والإنتاجية ("))}{visits.length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedSubTab('surveys')}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: selectedSubTab === 'surveys' ? '1px solid #170e5e' : '1px solid transparent',
              backgroundColor: selectedSubTab === 'surveys' ? '#170e5e' : 'transparent',
              color: selectedSubTab === 'surveys' ? '#ffffff' : '#475569',
              fontWeight: 600,
              fontSize: '12.5px',
              cursor: 'pointer',
            }}
          >
            {__t('delivery_reps.van_visits_tracking_admin_tab.s10', __t('delivery_reps.van_visits_tracking_admin_tab.s10', "تفتيش الثلاجات والمنافسين ("))}{surveys.length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedSubTab('breadcrumbs')}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: selectedSubTab === 'breadcrumbs' ? '1px solid #170e5e' : '1px solid transparent',
              backgroundColor: selectedSubTab === 'breadcrumbs' ? '#170e5e' : 'transparent',
              color: selectedSubTab === 'breadcrumbs' ? '#ffffff' : '#475569',
              fontWeight: 600,
              fontSize: '12.5px',
              cursor: 'pointer',
            }}
          >
            {__t('delivery_reps.van_visits_tracking_admin_tab.s11', __t('delivery_reps.van_visits_tracking_admin_tab.s11', "خريطة التتبع الحي ومسار اليوم"))}
          </button>
        </div>

        {/* Toolbar Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            style={{
              height: '32px',
              padding: '0 8px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '12px',
              color: '#0f172a',
            }}
          />
          <button
            type="button"
            onClick={() => setFilterNoSaleOnly(!filterNoSaleOnly)}
            style={{
              height: '32px',
              padding: '0 10px',
              borderRadius: '6px',
              border: filterNoSaleOnly ? '1px solid #ef4444' : '1px solid #cbd5e1',
              backgroundColor: filterNoSaleOnly ? '#fef2f2' : '#ffffff',
              color: filterNoSaleOnly ? '#b91c1c' : '#475569',
              fontSize: '11.5px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {filterNoSaleOnly ? __t('delivery_reps.van_visits_tracking_admin_tab.s12', __t('delivery_reps.van_visits_tracking_admin_tab.s12', "عرض كل الزيارات")) : __t('delivery_reps.van_visits_tracking_admin_tab.s13', __t('delivery_reps.van_visits_tracking_admin_tab.s13', "الزيارات السلبية فقط"))}
          </button>
          <Button
            variant="secondary"
            onClick={() => {
              refetchVisits();
              refetchSurveys();
            }}
            style={{ height: '32px', padding: '0 10px', fontSize: '11.5px' }}
          >
            <RefreshCwIcon size={13} style={{ marginInlineEnd: '4px' }} />
            {__t('delivery_reps.van_visits_tracking_admin_tab.s14', __t('delivery_reps.van_visits_tracking_admin_tab.s14', "تحديث"))}
          </Button>
        </div>
      </div>

      {/* SUB-TAB 1: VISITS TABLE */}
      {selectedSubTab === 'visits' && (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'start' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s15', __t('delivery_reps.van_visits_tracking_admin_tab.s15', "المحل والعميل"))}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s16', __t('delivery_reps.van_visits_tracking_admin_tab.s16', "وقت الوصول Check-In"))}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s17', __t('delivery_reps.van_visits_tracking_admin_tab.s17', "مدة الزيارة"))}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s18', __t('delivery_reps.van_visits_tracking_admin_tab.s18', "النطاق الجغرافي"))}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s19', __t('delivery_reps.van_visits_tracking_admin_tab.s19', "حالة الإنتاجية"))}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s20', __t('delivery_reps.van_visits_tracking_admin_tab.s20', "المبيعات والتحصيل"))}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s21', __t('delivery_reps.van_visits_tracking_admin_tab.s21', "جرد الرف"))}</th>
                </tr>
              </thead>
              <tbody>
                {isVisitsLoading ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}>
                      {__t('delivery_reps.van_visits_tracking_admin_tab.s22', __t('delivery_reps.van_visits_tracking_admin_tab.s22', "جاري تحميل سجل الزيارات الميدانية..."))}
                    </td>
                  </tr>
                ) : visits.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '36px', textAlign: 'center', color: '#94a3b8' }}>
                      {__t('delivery_reps.van_visits_tracking_admin_tab.s23', __t('delivery_reps.van_visits_tracking_admin_tab.s23', "لا توجد زيارات مسجلة في هذا التاريخ المحدد"))}
                    </td>
                  </tr>
                ) : (
                  visits.map((v: any) => {
                    const dwellMins = Math.round((v.dwellTimeSeconds || 0) / 60);
                    return (
                      <tr key={v.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0f172a' }}>
                          <div>{v.customerName || `عميل #${v.customerId}`}</div>
                          <div style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 500 }}>
                            {__t('delivery_reps.van_visits_tracking_admin_tab.s24', __t('delivery_reps.van_visits_tracking_admin_tab.s24', "رحلة #"))}{v.tripId || '—'}
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', color: '#334155' }}>
                          {v.checkInAt ? new Date(v.checkInAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#334155' }}>
                          <span style={{ fontWeight: 700 }}>{dwellMins}</span> {__t('delivery_reps.van_visits_tracking_admin_tab.s25', __t('delivery_reps.van_visits_tracking_admin_tab.s25', "دقيقة"))}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {v.isGeofenceValid ? (
                            <span style={{ backgroundColor: '#ecfdf5', color: '#065f46', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                              {__t('delivery_reps.van_visits_tracking_admin_tab.s26', __t('delivery_reps.van_visits_tracking_admin_tab.s26', "مطابق ("))}{v.geofenceDistanceMeters}{__t('delivery_reps.van_visits_tracking_admin_tab.s27', __t('delivery_reps.van_visits_tracking_admin_tab.s27', "م)"))}
                            </span>
                          ) : (
                            <span style={{ backgroundColor: '#fef2f2', color: '#991b1b', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                              {__t('delivery_reps.van_visits_tracking_admin_tab.s28', __t('delivery_reps.van_visits_tracking_admin_tab.s28', "كسر نطاق ("))}{v.geofenceDistanceMeters}{__t('delivery_reps.van_visits_tracking_admin_tab.s29', __t('delivery_reps.van_visits_tracking_admin_tab.s29', "م)"))}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {v.hasSale ? (
                            <span style={{ backgroundColor: '#dcfce7', color: '#166534', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                              {__t('delivery_reps.van_visits_tracking_admin_tab.s30', __t('delivery_reps.van_visits_tracking_admin_tab.s30', "✓ تم البيع بنجاح"))}
                            </span>
                          ) : (
                            <div>
                              <span style={{ backgroundColor: '#fee2e2', color: '#991b1b', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                                {__t('delivery_reps.van_visits_tracking_admin_tab.s31', __t('delivery_reps.van_visits_tracking_admin_tab.s31', "✕ زيارة سلبية (لم يشترِ)"))}
                              </span>
                              {v.noSaleReason && (
                                <div style={{ fontSize: '10.5px', color: '#b91c1c', marginTop: '3px', fontWeight: 600 }}>
                                  {__t('delivery_reps.van_visits_tracking_admin_tab.s32', __t('delivery_reps.van_visits_tracking_admin_tab.s32', "السبب:"))} {v.noSaleReason}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {v.saleAmount > 0 ? (
                            <div style={{ fontWeight: 800, color: '#15803d' }}>
                              {Number(v.saleAmount).toLocaleString('en-US')} <CurrencySymbol />
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {Array.isArray(v.storeInventory) && v.storeInventory.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => setSelectedInventoryVisit(v)}
                              style={{
                                backgroundColor: '#f1f5f9',
                                border: '1px solid #cbd5e1',
                                padding: '3px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                color: '#1e293b',
                              }}
                            >
                              {__t('delivery_reps.van_visits_tracking_admin_tab.s33', __t('delivery_reps.van_visits_tracking_admin_tab.s33', "عرض ("))}{v.storeInventory.length} {__t('delivery_reps.van_visits_tracking_admin_tab.s34', __t('delivery_reps.van_visits_tracking_admin_tab.s34', "صنف)"))}
                            </button>
                          ) : (
                            <span style={{ color: '#cbd5e1', fontSize: '11px' }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s35', __t('delivery_reps.van_visits_tracking_admin_tab.s35', "تم التخطي"))}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: TRADE MARKETING & COOLERS SURVEYS */}
      {selectedSubTab === 'surveys' && (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'start' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s36', __t('delivery_reps.van_visits_tracking_admin_tab.s36', "نوع التفتيش"))}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s37', __t('delivery_reps.van_visits_tracking_admin_tab.s37', "المحل / العميل"))}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s38', __t('delivery_reps.van_visits_tracking_admin_tab.s38', "بيانات الأصل / الثلاجة"))}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s39', __t('delivery_reps.van_visits_tracking_admin_tab.s39', "النظافة والتبريد"))}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s40', __t('delivery_reps.van_visits_tracking_admin_tab.s40', "منتجات منافسة؟"))}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s41', __t('delivery_reps.van_visits_tracking_admin_tab.s41', "رصد المنافس وسعره"))}</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s42', __t('delivery_reps.van_visits_tracking_admin_tab.s42', "التاريخ"))}</th>
                </tr>
              </thead>
              <tbody>
                {isSurveysLoading ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}>
                      {__t('delivery_reps.van_visits_tracking_admin_tab.s43', __t('delivery_reps.van_visits_tracking_admin_tab.s43', "جاري تحميل استطلاعات الميرشندايز والتفتيش..."))}
                    </td>
                  </tr>
                ) : surveys.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '36px', textAlign: 'center', color: '#94a3b8' }}>
                      {__t('delivery_reps.van_visits_tracking_admin_tab.s44', __t('delivery_reps.van_visits_tracking_admin_tab.s44', "لا توجد استطلاعات تفتيش مسجلة حالياً"))}
                    </td>
                  </tr>
                ) : (
                  surveys.map((s: any) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <span
                          style={{
                            backgroundColor: s.surveyType === 'cooler_inspection' ? '#e0f2fe' : '#fef3c7',
                            color: s.surveyType === 'cooler_inspection' ? '#0369a1' : '#b45309',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 700,
                          }}
                        >
                          {s.surveyType === 'cooler_inspection' ? __t('delivery_reps.van_visits_tracking_admin_tab.s45', __t('delivery_reps.van_visits_tracking_admin_tab.s45', "تفتيش ثلاجة وأصل")) : __t('delivery_reps.van_visits_tracking_admin_tab.s46', __t('delivery_reps.van_visits_tracking_admin_tab.s46', "استطلاع منافسين"))}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0f172a' }}>
                        {__t('delivery_reps.van_visits_tracking_admin_tab.s47', __t('delivery_reps.van_visits_tracking_admin_tab.s47', "عميل #"))}{s.customerId}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#334155' }}>
                        {s.assetName || s.assetId ? (
                          <div>
                            <div style={{ fontWeight: 700 }}>{s.assetName || __t('delivery_reps.van_visits_tracking_admin_tab.s48', __t('delivery_reps.van_visits_tracking_admin_tab.s48', "ثلاجة عرض"))}</div>
                            <div style={{ fontSize: '10.5px', color: '#64748b' }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s49', __t('delivery_reps.van_visits_tracking_admin_tab.s49', "كود:"))} {s.assetId || '—'}</div>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#334155' }}>
                        {s.temperatureCelsius != null && (
                          <div>{__t('delivery_reps.van_visits_tracking_admin_tab.s50', __t('delivery_reps.van_visits_tracking_admin_tab.s50', "حرارة:"))} <b>{s.temperatureCelsius}{__t('delivery_reps.van_visits_tracking_admin_tab.s51', __t('delivery_reps.van_visits_tracking_admin_tab.s51', "°م"))}</b></div>
                        )}
                        {s.cleanlinessRating && (
                          <div style={{ fontSize: '11px', color: '#d97706' }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s52', __t('delivery_reps.van_visits_tracking_admin_tab.s52', "نظافة:"))} {s.cleanlinessRating} / 5</div>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {s.isPureCompanyProducts ? (
                          <span style={{ color: '#16a34a', fontWeight: 700, fontSize: '11.5px' }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s53', __t('delivery_reps.van_visits_tracking_admin_tab.s53', "✓ نقية (منتجاتنا فقط)"))}</span>
                        ) : (
                          <span style={{ color: '#dc2626', fontWeight: 700, fontSize: '11.5px' }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s54', __t('delivery_reps.van_visits_tracking_admin_tab.s54', "✕ مخالفة (يوجد منافس)"))}</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#334155' }}>
                        {s.competitorName ? (
                          <div>
                            <div style={{ fontWeight: 700 }}>{s.competitorName} ({s.competitorProduct || ''})</div>
                            {s.competitorPrice && (
                              <div style={{ color: '#059669', fontSize: '11px' }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s55', __t('delivery_reps.van_visits_tracking_admin_tab.s55', "السعر:"))} {s.competitorPrice} {__t('delivery_reps.van_visits_tracking_admin_tab.s56', __t('delivery_reps.van_visits_tracking_admin_tab.s56', "ج.م"))}</div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b', fontSize: '11px' }}>
                        {new Date(s.createdAt).toLocaleDateString('ar-EG')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: LIVE GPS BREADCRUMBS & FLEET MAP */}
      {selectedSubTab === 'breadcrumbs' && (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                {__t('delivery_reps.van_visits_tracking_admin_tab.s57', __t('delivery_reps.van_visits_tracking_admin_tab.s57', "المسار الجغرافي الحي لحركة السيارة (GPS Breadcrumb Trail)"))}
              </h4>
              <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b' }}>
                {__t('delivery_reps.van_visits_tracking_admin_tab.s58', __t('delivery_reps.van_visits_tracking_admin_tab.s58', "رسم المسار الفعلي المتصل للسيارة طوال اليوم مع نقاط التوقف والمحطات المنفذة"))}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s59', __t('delivery_reps.van_visits_tracking_admin_tab.s59', "اختر رحلة التوزيع:"))}</span>
              <select
                value={selectedTripIdForTrail || ''}
                onChange={(e) => setSelectedTripIdForTrail(e.target.value ? Number(e.target.value) : null)}
                style={{
                  minWidth: '220px',
                  height: '32px',
                  padding: '0 8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '12px',
                  backgroundColor: '#ffffff',
                  color: '#0f172a',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <option value="">{__t('delivery_reps.van_visits_tracking_admin_tab.s60', __t('delivery_reps.van_visits_tracking_admin_tab.s60', "-- اختر الرحلة --"))}</option>
                {adminTrips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {__t('delivery_reps.van_visits_tracking_admin_tab.s61', __t('delivery_reps.van_visits_tracking_admin_tab.s61', "رحلة #"))}{t.id} • {t.repName} ({t.status === 'open' ? __t('delivery_reps.van_visits_tracking_admin_tab.s62', __t('delivery_reps.van_visits_tracking_admin_tab.s62', "نشطة الآن")) : __t('delivery_reps.van_visits_tracking_admin_tab.s63', __t('delivery_reps.van_visits_tracking_admin_tab.s63', "مغلقة"))})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Map & Coordinates Visualizer */}
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: breadcrumbs.length > 0 ? '16px' : '24px',
              minHeight: '320px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: breadcrumbs.length > 0 ? 'stretch' : 'center',
              justifyContent: breadcrumbs.length > 0 ? 'flex-start' : 'center',
              textAlign: breadcrumbs.length > 0 ? 'start' : 'center',
            }}
          >
            {!selectedTripIdForTrail ? (
              <div>
                <MapPinIcon size={36} color="#94a3b8" style={{ margin: '0 auto 10px' }} />
                <h5 style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 700, color: '#475569' }}>
                  {__t('delivery_reps.van_visits_tracking_admin_tab.s64', __t('delivery_reps.van_visits_tracking_admin_tab.s64', "يرجى تحديد رقم رحلة لعرض مسار الـ GPS"))}
                </h5>
                <p style={{ margin: 0, fontSize: '11.5px', color: '#94a3b8' }}>
                  {__t('delivery_reps.van_visits_tracking_admin_tab.s65', __t('delivery_reps.van_visits_tracking_admin_tab.s65', "سيتم رسم خط السير الفعلي لنقاط حركة المندوب والتوقفات عند المحلات"))}
                </p>
              </div>
            ) : isBreadcrumbsLoading ? (
              <div style={{ color: '#64748b', fontSize: '12.5px' }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s66', __t('delivery_reps.van_visits_tracking_admin_tab.s66', "جاري استرجاع إحداثيات المسار الحي..."))}</div>
            ) : breadcrumbs.length === 0 ? (
              <div>
                <AlertTriangleIcon size={32} color="#f59e0b" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#b45309' }}>
                  {__t('delivery_reps.van_visits_tracking_admin_tab.s67', __t('delivery_reps.van_visits_tracking_admin_tab.s67', "لا توجد نقاط تتبع مسجلة لهذه الرحلة حتى الآن"))}
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px' }}>
                  {__t('delivery_reps.van_visits_tracking_admin_tab.s68', __t('delivery_reps.van_visits_tracking_admin_tab.s68', "تأكد من بدء الرحلة وتفعيل صلاحية الموقع الجغرافي بهاتف المندوب"))}
                </div>
              </div>
            ) : (() => {
              const activeIndex = focusedPointIndex !== null && breadcrumbs[focusedPointIndex] ? focusedPointIndex : breadcrumbs.length - 1;
              const activePoint = breadcrumbs[activeIndex];
              return (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* Top Stats Banner */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#166534' }}>
                        {__t('delivery_reps.van_visits_tracking_admin_tab.s69', __t('delivery_reps.van_visits_tracking_admin_tab.s69', "تم تسجيل"))} {breadcrumbs.length} {__t('delivery_reps.van_visits_tracking_admin_tab.s70', __t('delivery_reps.van_visits_tracking_admin_tab.s70', "نقطة مسار جغرافي للرحلة #"))}{selectedTripIdForTrail}
                      </span>
                      <span style={{ fontSize: '11.5px', color: '#475569', backgroundColor: '#e2e8f0', padding: '2px 8px', borderRadius: '4px' }}>
                        {__t('delivery_reps.van_visits_tracking_admin_tab.s71', __t('delivery_reps.van_visits_tracking_admin_tab.s71', "النقطة المعروضة: #"))}{activeIndex + 1}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11.5px', color: '#64748b' }}>
                      <span>{__t('delivery_reps.van_visits_tracking_admin_tab.s72', __t('delivery_reps.van_visits_tracking_admin_tab.s72', "آخر تحديث:"))} {new Date(breadcrumbs[breadcrumbs.length - 1].recordedAt).toLocaleTimeString('ar-EG')}</span>
                      <a
                        href={`https://www.google.com/maps?q=${activePoint.latitude},${activePoint.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: '#170e5e',
                          fontWeight: 700,
                          textDecoration: 'none',
                        }}
                      >
                        {__t('delivery_reps.van_visits_tracking_admin_tab.s73', __t('delivery_reps.van_visits_tracking_admin_tab.s73', "فتح في خرائط Google ↗"))}
                      </a>
                    </div>
                  </div>

                  {/* Interactive Map Canvas */}
                  <div
                    style={{
                      position: 'relative',
                      width: '100%',
                      height: '380px',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      border: '1px solid #cbd5e1',
                      backgroundColor: '#e2e8f0',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                    }}
                  >
                    <iframe
                      title="Interactive Route Map"
                      width="100%"
                      height="100%"
                      style={{ border: 0 }}
                      loading="lazy"
                      src={`https://maps.google.com/maps?q=${activePoint.latitude},${activePoint.longitude}&hl=ar&z=16&output=embed`}
                    />
                    {/* Floating Info Pill */}
                    <div
                      style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        backgroundColor: 'rgba(255, 255, 255, 0.96)',
                        backdropFilter: 'blur(4px)',
                        padding: '8px 14px',
                        borderRadius: '8px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        color: '#170e5e',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        border: '1px solid #e2e8f0',
                        flexWrap: 'wrap',
                        maxWidth: '90%',
                      }}
                    >
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#16a34a', display: 'inline-block' }} />
                      <span>{__t('delivery_reps.van_visits_tracking_admin_tab.s74', __t('delivery_reps.van_visits_tracking_admin_tab.s74', "محطة #"))}{activeIndex + 1}</span>
                      {activePoint.customerName && (
                        <span style={{ color: '#0f172a' }}>• {activePoint.customerName}</span>
                      )}
                      {activePoint.saleAmount != null && activePoint.saleAmount > 0 && (
                        <span style={{ color: '#166534', backgroundColor: '#dcfce7', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
                          {__t('delivery_reps.van_visits_tracking_admin_tab.s75', __t('delivery_reps.van_visits_tracking_admin_tab.s75', "فاتورة #"))}{activePoint.docNo}: {activePoint.saleAmount} {__t('delivery_reps.van_visits_tracking_admin_tab.s76', __t('delivery_reps.van_visits_tracking_admin_tab.s76', "ج.م ("))}{activePoint.paymentType === 'cash' ? __t('delivery_reps.van_visits_tracking_admin_tab.s77', __t('delivery_reps.van_visits_tracking_admin_tab.s77', "نقدي")) : __t('delivery_reps.van_visits_tracking_admin_tab.s78', __t('delivery_reps.van_visits_tracking_admin_tab.s78', "آجل"))})
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Waypoints Timeline List */}
                  <div>
                    <h5 style={{ margin: '0 0 8px', fontSize: '12.5px', fontWeight: 800, color: '#1e293b' }}>
                      {__t('delivery_reps.van_visits_tracking_admin_tab.s79', __t('delivery_reps.van_visits_tracking_admin_tab.s79', "سجل نقاط ومحطات المسار الفعلي وتفاصيل العمليات (اضغط على أي محطة لإظهارها على الخريطة):"))}
                    </h5>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto' }}>
                      {breadcrumbs.map((b: any, idx: number) => {
                        const isCurrentActive = idx === activeIndex;
                        return (
                          <div
                            key={b.id || idx}
                            onClick={() => setFocusedPointIndex(idx)}
                            style={{
                              backgroundColor: isCurrentActive ? '#f0fdf4' : '#ffffff',
                              border: isCurrentActive ? '1.5px solid #16a34a' : '1px solid #e2e8f0',
                              borderRadius: '8px',
                              padding: '10px 14px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: '11.5px',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              boxShadow: isCurrentActive ? '0 1px 3px rgba(22, 101, 52, 0.1)' : 'none',
                              gap: '12px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span
                                style={{
                                  width: '26px',
                                  height: '26px',
                                  borderRadius: '50%',
                                  backgroundColor: isCurrentActive ? '#16a34a' : '#170e5e',
                                  color: '#ffffff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '11px',
                                  fontWeight: 800,
                                  flexShrink: 0,
                                }}
                              >
                                {idx + 1}
                              </span>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>
                                    {b.customerName ? b.customerName : `محطة توقف #${idx + 1}`}
                                  </span>
                                  {b.saleAmount != null && b.saleAmount > 0 && (
                                    <span style={{ fontSize: '11px', backgroundColor: '#dcfce7', color: '#166534', padding: '1px 8px', borderRadius: '4px', fontWeight: 800 }}>
                                      {__t('delivery_reps.van_visits_tracking_admin_tab.s80', __t('delivery_reps.van_visits_tracking_admin_tab.s80', "فاتورة بيع #"))}{b.docNo} • {b.saleAmount.toFixed(2)} {__t('delivery_reps.van_visits_tracking_admin_tab.s81', __t('delivery_reps.van_visits_tracking_admin_tab.s81', "ج.م ("))}{b.paymentType === 'cash' ? __t('delivery_reps.van_visits_tracking_admin_tab.s82', __t('delivery_reps.van_visits_tracking_admin_tab.s82', "كاش")) : b.paymentType === 'credit' ? __t('delivery_reps.van_visits_tracking_admin_tab.s83', __t('delivery_reps.van_visits_tracking_admin_tab.s83', "آجل")) : __t('delivery_reps.van_visits_tracking_admin_tab.s84', __t('delivery_reps.van_visits_tracking_admin_tab.s84', "مجزء"))})
                                    </span>
                                  )}
                                  {isCurrentActive && (
                                    <span style={{ fontSize: '10.5px', backgroundColor: '#e0f2fe', color: '#0369a1', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                                      {__t('delivery_reps.van_visits_tracking_admin_tab.s85', __t('delivery_reps.van_visits_tracking_admin_tab.s85', "معروضة على الخريطة أعلاه"))}
                                    </span>
                                  )}
                                </div>
                                <span style={{ fontSize: '11px', color: '#64748b' }}>
                                  {__t('delivery_reps.van_visits_tracking_admin_tab.s86', __t('delivery_reps.van_visits_tracking_admin_tab.s86', "الموقع:"))} {b.latitude.toFixed(5)}, {b.longitude.toFixed(5)} {b.customerPhone ? `• هاتف: ${b.customerPhone}` : ''} {b.notes ? `• ملاحظات: ${b.notes}` : ''}
                                </span>
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: '#64748b', flexShrink: 0 }}>
                              <span>{__t('delivery_reps.van_visits_tracking_admin_tab.s87', __t('delivery_reps.van_visits_tracking_admin_tab.s87', "السرعة:"))} {b.speedKmh} {__t('delivery_reps.van_visits_tracking_admin_tab.s88', __t('delivery_reps.van_visits_tracking_admin_tab.s88', "كم/س"))}</span>
                              <span>{__t('delivery_reps.van_visits_tracking_admin_tab.s89', __t('delivery_reps.van_visits_tracking_admin_tab.s89', "البطارية:"))} {b.batteryLevel}%</span>
                              <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '12px' }}>
                                {new Date(b.recordedAt).toLocaleTimeString('ar-EG')}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Modal: Store Inventory Viewer */}
      {selectedInventoryVisit && (
        <StandardDialog
          open={true}
          onClose={() => setSelectedInventoryVisit(null)}
          title={`جرد رصيد رف العميل: ${selectedInventoryVisit.customerName}`}
          subtitle={__t('delivery_reps.van_visits_tracking_admin_tab.s90', __t('delivery_reps.van_visits_tracking_admin_tab.s90', "الأصناف والكميات المتبقية على رف المحل أثناء الزيارة"))}
          badge={__t('delivery_reps.van_visits_tracking_admin_tab.s91', __t('delivery_reps.van_visits_tracking_admin_tab.s91', "جرد الرف"))}
          width="min(560px, 96vw)"
          footerActions={
            <StandardDialogFooter
              onClose={() => setSelectedInventoryVisit(null)}
              cancelText={__t('delivery_reps.van_visits_tracking_admin_tab.s92', __t('delivery_reps.van_visits_tracking_admin_tab.s92', "إغلاق"))}
            />
          }
        >
          <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'start' }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s93', __t('delivery_reps.van_visits_tracking_admin_tab.s93', "الصنف"))}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s94', __t('delivery_reps.van_visits_tracking_admin_tab.s94', "الكمية على الرف"))}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>{__t('delivery_reps.van_visits_tracking_admin_tab.s95', __t('delivery_reps.van_visits_tracking_admin_tab.s95', "تاريخ الصلاحية"))}</th>
                </tr>
              </thead>
              <tbody>
                {(selectedInventoryVisit.storeInventory || []).map((it: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{it.productName || `صنف #${it.productId}`}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 800, color: '#170e5e' }}>{it.qtyOnShelf}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: '#64748b' }}>{it.expiryDate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StandardDialog>
      )}
    </div>
  );
};
