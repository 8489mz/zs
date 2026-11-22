import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import { CalendarIcon, RefreshCwIcon } from '@/shared/components/icons/AppIcons';

export interface RoutesKpiDateFiltersProps {
  dateFrom: string;
  setDateFrom: Dispatch<SetStateAction<string>>;
  dateTo: string;
  setDateTo: Dispatch<SetStateAction<string>>;
  isRefreshing: boolean;
  handleManualRefresh: () => Promise<void>;
}

export function RoutesKpiDateFilters({
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  isRefreshing,
  handleManualRefresh,
}: RoutesKpiDateFiltersProps) {
  const { t: __t } = useTranslation();
  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: '12px',
        padding: '12px 16px',
        border: '1px solid #e2e8f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <CalendarIcon size={14} color="#64748b" />
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s0', __t('delivery_reps.van_routes_kpi_admin_tab.s0', "الفترة:"))}</span>
        </div>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          style={{
            padding: '6px 10px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: '12px',
            color: '#0f172a',
          }}
        />
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s1', __t('delivery_reps.van_routes_kpi_admin_tab.s1', "إلى"))}</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          style={{
            padding: '6px 10px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: '12px',
            color: '#0f172a',
          }}
        />
        {(dateFrom || dateTo) && (
          <Button
            variant="secondary"
            style={{ fontSize: '11px', padding: '4px 8px' }}
            onClick={() => {
              setDateFrom('');
              setDateTo('');
            }}
          >
            {__t('delivery_reps.van_routes_kpi_admin_tab.s2', __t('delivery_reps.van_routes_kpi_admin_tab.s2', "إلغاء الفلتر"))}
          </Button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Button
          variant="secondary"
          disabled={isRefreshing}
          style={{
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: isRefreshing ? 'wait' : 'pointer',
            opacity: isRefreshing ? 0.75 : 1,
          }}
          onClick={handleManualRefresh}
          title={__t('delivery_reps.van_routes_kpi_admin_tab.s3', __t('delivery_reps.van_routes_kpi_admin_tab.s3', "تحديث بيانات خطوط السير والرقابة من السيرفر"))}
        >
          <RefreshCwIcon
            size={13}
            className={isRefreshing ? 'spin-animation' : undefined}
            style={isRefreshing ? { animation: 'spin 0.75s linear infinite' } : undefined}
          />
          {isRefreshing ? __t('delivery_reps.van_routes_kpi_admin_tab.s4', __t('delivery_reps.van_routes_kpi_admin_tab.s4', "جارٍ التحديث...")) : __t('delivery_reps.van_routes_kpi_admin_tab.s5', __t('delivery_reps.van_routes_kpi_admin_tab.s5', "تحديث البيانات"))}
        </Button>
      </div>
    </div>
  );
}
