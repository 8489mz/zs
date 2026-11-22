import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { SupervisorCustomerRouteItem } from '../../api/van-sales.api';
import { normalizeDayKey } from '../VanItineraryTab';
import { WEEKDAYS } from './van-routes-kpi-consts';
import { Button } from '@/shared/ui/button';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  CheckCircleIcon,
  EditIcon,
  MapPinIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersIcon,
  TruckIcon,
} from '@/shared/components/icons/AppIcons';

export interface RoutesKpiSchedulingProps {
  routeFilter: 'all' | string;
  handleOptimizeSupervisorRoute: () => Promise<void>;
  isOptimizingRoute: boolean;
  customerRoutes: SupervisorCustomerRouteItem[];
  customerSearch: string;
  setCustomerSearch: Dispatch<SetStateAction<string>>;
  repFilter: 'all' | 'unassigned' | string;
  setRepFilter: Dispatch<SetStateAction<'all' | 'unassigned' | string>>;
  repFilterOptions: { value: string; label: string }[];
  setRouteFilter: Dispatch<SetStateAction<'all' | string>>;
  routeFilterOptions: { value: string; label: string }[];
  selectedCustomerIds: number[];
  setBulkRepId: Dispatch<SetStateAction<string>>;
  setBulkRouteInput: Dispatch<SetStateAction<string>>;
  setBulkApplyDays: Dispatch<SetStateAction<boolean>>;
  setBulkVisitDays: Dispatch<SetStateAction<string[]>>;
  setBulkModalOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedCustomerIds: Dispatch<SetStateAction<number[]>>;
  isRoutesLoading: boolean;
  isAllSelected: boolean;
  toggleSelectAll: () => void;
  toggleSelectCustomer: (customerId: number) => void;
  openScheduleModal: (customer: SupervisorCustomerRouteItem) => void;
}

export function RoutesKpiScheduling({
  routeFilter,
  handleOptimizeSupervisorRoute,
  isOptimizingRoute,
  customerRoutes,
  customerSearch,
  setCustomerSearch,
  repFilter,
  setRepFilter,
  repFilterOptions,
  setRouteFilter,
  routeFilterOptions,
  selectedCustomerIds,
  setBulkRepId,
  setBulkRouteInput,
  setBulkApplyDays,
  setBulkVisitDays,
  setBulkModalOpen,
  setSelectedCustomerIds,
  isRoutesLoading,
  isAllSelected,
  toggleSelectAll,
  toggleSelectCustomer,
  openScheduleModal,
}: RoutesKpiSchedulingProps) {
  const { t: __t } = useTranslation();
  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid #f1f5f9',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
            {__t('delivery_reps.van_routes_kpi_admin_tab.s75', __t('delivery_reps.van_routes_kpi_admin_tab.s75', "تخصيص خطوط السير والمناديب للمتاجر والعملاء"))}
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
            {__t('delivery_reps.van_routes_kpi_admin_tab.s76', __t('delivery_reps.van_routes_kpi_admin_tab.s76', "توزيع محلات التوزيع على مناديب الفان، تثبيت مسارات وخطوط السير، تسلسل الزيارة، وأيام التغطية الأسبوعية"))}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {routeFilter !== 'all' && (
            <Button
              variant="primary"
              onClick={handleOptimizeSupervisorRoute}
              disabled={isOptimizingRoute}
              style={{
                backgroundColor: '#170e5e',
                color: '#ffffff',
                height: '32px',
                fontSize: '12px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              title={__t('delivery_reps.van_routes_kpi_admin_tab.s77', __t('delivery_reps.van_routes_kpi_admin_tab.s77', "إعادة الترتيب التلقائي بأقصر مسار جغرافي لتوفير الوقود وحفظ التسلسل الدائم"))}
            >
              <MapPinIcon size={14} />
              {isOptimizingRoute ? __t('delivery_reps.van_routes_kpi_admin_tab.s78', __t('delivery_reps.van_routes_kpi_admin_tab.s78', "جاري التحسين...")) : `الترتيب الجغرافي الأمثل لخط «${routeFilter}» (TSP)`}
            </Button>
          )}
          <span
            style={{
              background: '#f1f5f9',
              color: '#475569',
              padding: '5px 12px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            {__t('delivery_reps.van_routes_kpi_admin_tab.s79', __t('delivery_reps.van_routes_kpi_admin_tab.s79', "إجمالي المتاجر:"))} {customerRoutes.length}
          </span>
        </div>
      </div>

      {/* Supervisor Filters Strip */}
      <div
        style={{
          padding: '12px 20px',
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        {/* Search Input */}
        <div style={{ flex: '1 1 240px', minWidth: '200px', position: 'relative' }}>
          <input
            type="text"
            placeholder={__t('delivery_reps.van_routes_kpi_admin_tab.s80', __t('delivery_reps.van_routes_kpi_admin_tab.s80', "بحث باسم المحل، الكود، الهاتف، أو خط السير..."))}
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '7px 12px 7px 32px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '12.5px',
              boxSizing: 'border-box',
              background: '#ffffff',
            }}
          />
          <span
            style={{
              position: 'absolute',
              left: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
              color: '#94a3b8',
            }}
          >
            <SearchIcon size={14} />
          </span>
        </div>

        {/* Rep Filter */}
        <div style={{ flex: '0 1 220px', minWidth: '180px' }}>
          <CustomSelect
            value={repFilter}
            onChange={(val) => setRepFilter(val as any)}
            options={repFilterOptions}
            placeholder={__t('delivery_reps.van_routes_kpi_admin_tab.s81', __t('delivery_reps.van_routes_kpi_admin_tab.s81', "فلترة بالمندوب..."))}
          />
        </div>

        {/* Route Filter */}
        <div style={{ flex: '0 1 200px', minWidth: '160px' }}>
          <CustomSelect
            value={routeFilter}
            onChange={(val) => setRouteFilter(val as any)}
            options={routeFilterOptions}
            placeholder={__t('delivery_reps.van_routes_kpi_admin_tab.s82', __t('delivery_reps.van_routes_kpi_admin_tab.s82', "فلترة بالخط..."))}
          />
        </div>

        {/* Clear Filters Button (if active) */}
        {(customerSearch || repFilter !== 'all' || routeFilter !== 'all') && (
          <Button
            variant="secondary"
            style={{ fontSize: '11.5px', padding: '6px 12px' }}
            onClick={() => {
              setCustomerSearch('');
              setRepFilter('all');
              setRouteFilter('all');
            }}
          >
            {__t('delivery_reps.van_routes_kpi_admin_tab.s83', __t('delivery_reps.van_routes_kpi_admin_tab.s83', "إعادة ضبط الفلاتر"))}
          </Button>
        )}
      </div>

      {/* Bulk Selection Action Bar */}
      {selectedCustomerIds.length > 0 && (
        <div
          style={{
            padding: '10px 20px',
            background: '#eef2ff',
            borderBottom: '1px solid #c7d2fe',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircleIcon size={16} color="#3730a3" />
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#312e81' }}>
              {__t('delivery_reps.van_routes_kpi_admin_tab.s84', __t('delivery_reps.van_routes_kpi_admin_tab.s84', "تم تحديد"))} {selectedCustomerIds.length} {__t('delivery_reps.van_routes_kpi_admin_tab.s85', __t('delivery_reps.van_routes_kpi_admin_tab.s85', "متجر / عميل"))}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Button
              variant="primary"
              style={{
                backgroundColor: '#170e5e',
                color: '#ffffff',
                fontSize: '12px',
                padding: '6px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 700,
              }}
              onClick={() => {
                setBulkRepId('no_change');
                setBulkRouteInput('');
                setBulkApplyDays(false);
                setBulkVisitDays(['saturday', 'monday', 'wednesday']);
                setBulkModalOpen(true);
              }}
            >
              <SlidersIcon size={13} />
              {__t('delivery_reps.van_routes_kpi_admin_tab.s86', __t('delivery_reps.van_routes_kpi_admin_tab.s86', "تخصيص جماعي للمندوب والخط ("))}{selectedCustomerIds.length})
            </Button>
            <Button
              variant="secondary"
              style={{ fontSize: '12px', padding: '6px 12px' }}
              onClick={() => setSelectedCustomerIds([])}
            >
              {__t('delivery_reps.van_routes_kpi_admin_tab.s87', __t('delivery_reps.van_routes_kpi_admin_tab.s87', "إلغاء التحديد"))}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {isRoutesLoading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
          <RefreshCwIcon size={20} className="spin-animation" style={{ margin: '0 auto 10px', display: 'block' }} />
          {__t('delivery_reps.van_routes_kpi_admin_tab.s88', __t('delivery_reps.van_routes_kpi_admin_tab.s88', "جارٍ تحميل قائمة المحلات وبيانات التخصيص..."))}
        </div>
      ) : customerRoutes.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
          {__t('delivery_reps.van_routes_kpi_admin_tab.s89', __t('delivery_reps.van_routes_kpi_admin_tab.s89', "لا توجد متاجر مطابقة لمعايير البحث والفلترة."))}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '10px 14px', width: '38px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={toggleSelectAll}
                    title={__t('delivery_reps.van_routes_kpi_admin_tab.s90', __t('delivery_reps.van_routes_kpi_admin_tab.s90', "تحديد الكل"))}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th style={{ padding: '10px 14px', fontWeight: 700, width: '90px' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s91', __t('delivery_reps.van_routes_kpi_admin_tab.s91', "كود المحل"))}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700, minWidth: '170px' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s92', __t('delivery_reps.van_routes_kpi_admin_tab.s92', "اسم المحل / العميل"))}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700, minWidth: '150px' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s93', __t('delivery_reps.van_routes_kpi_admin_tab.s93', "المندوب المسؤول"))}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700, minWidth: '130px' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s94', __t('delivery_reps.van_routes_kpi_admin_tab.s94', "خط السير"))}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'center', width: '90px' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s95', __t('delivery_reps.van_routes_kpi_admin_tab.s95', "الترتيب"))}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700, minWidth: '160px' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s96', __t('delivery_reps.van_routes_kpi_admin_tab.s96', "أيام الزيارة الأسبوعية"))}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'left', minWidth: '100px' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s97', __t('delivery_reps.van_routes_kpi_admin_tab.s97', "رصيد المديونية"))}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'center', width: '110px' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s98', __t('delivery_reps.van_routes_kpi_admin_tab.s98', "الإجراءات"))}</th>
              </tr>
            </thead>
            <tbody>
              {customerRoutes.map((c) => {
                const isSelected = selectedCustomerIds.includes(c.customerId);
                return (
                  <tr
                    key={c.customerId}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      backgroundColor: isSelected ? '#f8fafc' : 'transparent',
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectCustomer(c.customerId)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 700, color: '#64748b' }}>
                      {c.customerCode ? c.customerCode.replace(/^#/, '') : `C-${String(c.customerId).padStart(4, '0')}`}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>
                        {c.customerName}
                      </div>
                      {(c.customerPhone || c.customerAddress) && (
                        <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', gap: '8px', marginTop: '2px', alignItems: 'center' }}>
                          {c.customerPhone && <span>{c.customerPhone}</span>}
                          {c.customerPhone && c.customerAddress && <span>•</span>}
                          {c.customerAddress && <span>{c.customerAddress}</span>}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {Array.isArray(c.assignedRepNames) && c.assignedRepNames.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {c.assignedRepNames.map((rName, idx) => (
                            <span
                              key={`${c.customerId}-rep-${idx}`}
                              style={{
                                background: '#e0f2fe',
                                color: '#0369a1',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontWeight: 700,
                                fontSize: '11.5px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <TruckIcon size={12} />
                              {rName}
                            </span>
                          ))}
                        </div>
                      ) : c.assignedRepName ? (
                        <span
                          style={{
                            background: '#e0f2fe',
                            color: '#0369a1',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontWeight: 700,
                            fontSize: '11.5px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <TruckIcon size={12} />
                          {c.assignedRepName}
                        </span>
                      ) : (
                        <span
                          style={{
                            background: '#fef3c7',
                            color: '#92400e',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontWeight: 600,
                            fontSize: '11px',
                          }}
                        >
                          {__t('delivery_reps.van_routes_kpi_admin_tab.s99', __t('delivery_reps.van_routes_kpi_admin_tab.s99', "غير مخصص لمندوب"))}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          background: '#f1f5f9',
                          color: '#334155',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontWeight: 700,
                          fontSize: '11.5px',
                        }}
                      >
                        {c.route || __t('delivery_reps.van_routes_kpi_admin_tab.s100', __t('delivery_reps.van_routes_kpi_admin_tab.s100', "غير محدد"))}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 800, color: '#170e5e' }}>
                      #{c.routeSequence || 1}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {((Array.isArray(c.visitDays) && c.visitDays.length > 0) ? c.visitDays : (c.visitDay ? [c.visitDay] : [])).length > 0 ? (
                          ((Array.isArray(c.visitDays) && c.visitDays.length > 0) ? c.visitDays : [c.visitDay!]).map((d: string) => {
                            const found = WEEKDAYS.find((w) => w.id === d || w.id === normalizeDayKey(d) || w.label === d);
                            return (
                              <span
                                key={d}
                                style={{
                                  background: '#e0e7ff',
                                  color: '#3730a3',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  fontSize: '10.5px',
                                  fontWeight: 600,
                                }}
                              >
                                {found?.label || d}
                              </span>
                            );
                          })
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: '11px' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s101', __t('delivery_reps.van_routes_kpi_admin_tab.s101', "يومياً / غير محدد"))}</span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'left', minWidth: '170px' }}>
                      <div style={{ fontWeight: 800, fontSize: '13px', color: Number(c.balance || 0) > 0 ? '#b91c1c' : '#15803d' }}>
                        {__t('delivery_reps.van_routes_kpi_admin_tab.s102', __t('delivery_reps.van_routes_kpi_admin_tab.s102', "إجمالي:"))} {Number(c.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <CurrencySymbol />
                      </div>
                      {Array.isArray(c.repBalances) && c.repBalances.filter((rb) => rb.balance !== 0).length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px' }}>
                          {c.repBalances
                            .filter((rb) => rb.balance !== 0)
                            .map((rb) => (
                              <div
                                key={`${c.customerId}-bal-${rb.repId}`}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  gap: '6px',
                                  background: '#fff1f2',
                                  border: '1px solid #fecdd3',
                                  borderRadius: '5px',
                                  padding: '2px 6px',
                                  fontSize: '10.5px',
                                  color: '#9f1239',
                                  fontWeight: 700,
                                }}
                              >
                                <span>{rb.repName}:</span>
                                <span>
                                  {Number(rb.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <CurrencySymbol />
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <Button
                        variant="secondary"
                        style={{ fontSize: '11px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => openScheduleModal(c)}
                      >
                        <EditIcon size={12} />
                        {__t('delivery_reps.van_routes_kpi_admin_tab.s103', __t('delivery_reps.van_routes_kpi_admin_tab.s103', "تعديل التخصيص"))}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
