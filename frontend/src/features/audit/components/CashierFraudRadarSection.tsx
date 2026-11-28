import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@/lib/format';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import {
  AlertTriangleIcon,
  BarChartIcon,
  CreditCardIcon,
  RefreshCwIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TruckIcon,
} from '@/shared/components/icons/AppIcons';
import { cashierFraudRadarApi } from '../api/cashier-fraud-radar.api';
import { PosRadarAndBenchmarksTab } from './loss-prevention/PosRadarAndBenchmarksTab';
import { InTransitCustodyTab } from './loss-prevention/InTransitCustodyTab';
import { ShrinkageAndHotSkusTab } from './loss-prevention/ShrinkageAndHotSkusTab';
import { ShiftsAndDeliveryCustodyTab } from './loss-prevention/ShiftsAndDeliveryCustodyTab';
import { AntiTheftControlsTab } from './loss-prevention/AntiTheftControlsTab';

type CommandCenterTab = 'pos_radar' | 'in_transit' | 'shrinkage' | 'shifts_delivery' | 'controls';

export function CashierFraudRadarSection() {
  const [timeframe, setTimeframe] = useState<'today' | '7days' | '30days'>('today');
  const [activeTab, setActiveTab] = useState<CommandCenterTab>('pos_radar');
  const [selectedCashierId, setSelectedCashierId] = useState<number | null>(null);

  const commandCenterQuery = useQuery({
    queryKey: ['loss-prevention-command-center', timeframe],
    queryFn: () => cashierFraudRadarApi.getCommandCenter(timeframe),
    refetchInterval: 30_000,
  });

  const data = commandCenterQuery.data;
  const headline = data?.headlineMetrics;

  const tabs: Array<{
    id: CommandCenterTab;
    label: string;
    badge?: number;
    icon: React.ReactNode;
  }> = [
    {
      id: 'pos_radar',
      label: 'رادار الكاشير وتوقيت الكاميرا',
      badge: data?.posRadar.summary.totalSuspiciousEvents || 0,
      icon: <ShieldCheckIcon size={15} />,
    },
    {
      id: 'in_transit',
      label: 'عهدة الناقلين والبضاعة بالطريق',
      badge: data?.inTransitCustody.openCount || 0,
      icon: <TruckIcon size={15} />,
    },
    {
      id: 'shrinkage',
      label: 'الفاقد والتالف والأصناف الساخنة',
      badge: data?.shrinkage.totalIncidents || 0,
      icon: <BarChartIcon size={15} />,
    },
    {
      id: 'shifts_delivery',
      label: 'عجز الورديات وعهد المناديب',
      badge:
        (data?.shiftsAndDelivery.shortageShiftsCount || 0) +
        (data?.shiftsAndDelivery.overdueDeliveryOrdersCount || 0),
      icon: <CreditCardIcon size={15} />,
    },
    {
      id: 'controls',
      label: 'إعدادات درع منع السرقة',
      icon: <SettingsIcon size={15} />,
    },
  ];

  return (
    <div
      className="cashier-fraud-radar-section"
      dir="rtl"
      style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      {/* Top Control Header — Clean White Institutional Card */}
      <div style={headerCardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={heroBadgeIconStyle}>
            <ShieldCheckIcon size={22} />
          </span>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
              غرفة عمليات منع الخسائر ومكافحة السرقة الداخلية
            </h2>
            <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '2px' }}>
              رقابة شاملة لحظية على نقاط البيع، البضاعة بالطريق، الفاقد والتالف، وعهد المناديب والورديات
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {(
            [
              { id: 'today', label: 'اليوم' },
              { id: '7days', label: 'آخر 7 أيام' },
              { id: '30days', label: 'آخر 30 يوماً' },
            ] as const
          ).map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => setTimeframe(tf.id)}
              style={{
                padding: '7px 12px',
                borderRadius: '8px',
                fontSize: '12.5px',
                fontWeight: 600,
                boxSizing: 'border-box',
                border: timeframe === tf.id ? '1px solid #170e5e' : '1px solid #cbd5e1',
                backgroundColor: timeframe === tf.id ? '#170e5e' : '#ffffff',
                color: timeframe === tf.id ? '#ffffff' : '#334155',
                cursor: 'pointer',
              }}
            >
              {tf.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void commandCenterQuery.refetch()}
            style={refreshBtnStyle}
            disabled={commandCenterQuery.isFetching}
          >
            <RefreshCwIcon size={14} />
            تحديث
          </button>
        </div>
      </div>

      {/* Headline KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
        <div style={kpiCardStyle}>
          <div style={kpiLabelStyle}>إجمالي التعرض المالي المرصود</div>
          <div style={{ ...kpiValueStyle, color: (headline?.totalFinancialExposure || 0) > 0 ? '#b91c1c' : '#0f172a' }}>
            {commandCenterQuery.isLoading ? '—' : formatCurrency(headline?.totalFinancialExposure || 0)}{' '}
            <CurrencySymbol />
          </div>
          <div style={kpiSubStyle}>سلال ممسوحة + تالف وعجز مخزني + عجز ورديات</div>
        </div>

        <div style={kpiCardStyle}>
          <div style={kpiLabelStyle}>تنبيهات خطرة تتطلب مراجعة</div>
          <div style={{ ...kpiValueStyle, color: (headline?.criticalAlertsCount || 0) > 0 ? '#b91c1c' : '#15803d' }}>
            {commandCenterQuery.isLoading ? '—' : headline?.criticalAlertsCount || 0}
          </div>
          <div style={kpiSubStyle}>
            كاشيرات عالي الخطورة: {headline?.highRiskCashiersCount || 0} | متأخر بالطريق:{' '}
            {headline?.overdueTransfersCount || 0}
          </div>
        </div>

        <div style={kpiCardStyle}>
          <div style={kpiLabelStyle}>بضاعة بالطريق (عهدة الناقلين)</div>
          <div style={kpiValueStyle}>
            {commandCenterQuery.isLoading ? '—' : formatCurrency(data?.inTransitCustody.totalEstimatedCost || 0)}{' '}
            <CurrencySymbol />
          </div>
          <div style={kpiSubStyle}>
            {data?.inTransitCustody.openCount || 0} إذن مفتوح | متأخر: {data?.inTransitCustody.overdueCount || 0}
          </div>
        </div>

        <div style={kpiCardStyle}>
          <div style={kpiLabelStyle}>عهد المناديب المعلقة</div>
          <div style={kpiValueStyle}>
            {commandCenterQuery.isLoading
              ? '—'
              : formatCurrency(data?.shiftsAndDelivery.totalUnsettledDeliveryCash || 0)}{' '}
            <CurrencySymbol />
          </div>
          <div style={kpiSubStyle}>
            طلبات متأخرة عن التسوية: {headline?.overdueDeliveriesCount || 0} | أصناف ساخنة: {headline?.hotSkusCount || 0}
          </div>
        </div>
      </div>

      {/* Zero-Flicker 0ms Navigation Tabs */}
      <div style={tabBarStyle}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                padding: '9px 14px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 600,
                boxSizing: 'border-box',
                border: isActive ? '1px solid #170e5e' : '1px solid #e2e8f0',
                backgroundColor: isActive ? '#170e5e' : '#f8fafc',
                color: isActive ? '#ffffff' : '#334155',
                cursor: 'pointer',
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span
                  style={{
                    padding: '1px 7px',
                    borderRadius: '9999px',
                    fontSize: '11px',
                    fontWeight: 700,
                    backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : '#e2e8f0',
                    color: isActive ? '#ffffff' : '#0f172a',
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Tab Content */}
      {commandCenterQuery.isLoading ? (
        <div style={loadingBoxStyle}>جاري تحميل بيانات غرفة عمليات منع الخسائر...</div>
      ) : commandCenterQuery.isError || !data ? (
        <div style={errorBoxStyle}>
          <AlertTriangleIcon size={24} color="#b91c1c" />
          <div style={{ fontWeight: 700, color: '#991b1b', marginTop: '6px' }}>
            تعذر تحميل بيانات غرفة عمليات منع الخسائر
          </div>
          <button
            type="button"
            onClick={() => void commandCenterQuery.refetch()}
            style={{ ...refreshBtnStyle, marginTop: '10px' }}
          >
            إعادة المحاولة
          </button>
        </div>
      ) : (
        <>
          {activeTab === 'pos_radar' && (
            <PosRadarAndBenchmarksTab
              summary={data.posRadar.summary}
              events={data.posRadar.events}
              selectedCashierId={selectedCashierId}
              onSelectCashier={setSelectedCashierId}
            />
          )}
          {activeTab === 'in_transit' && <InTransitCustodyTab data={data.inTransitCustody} />}
          {activeTab === 'shrinkage' && <ShrinkageAndHotSkusTab shrinkage={data.shrinkage} />}
          {activeTab === 'shifts_delivery' && (
            <ShiftsAndDeliveryCustodyTab
              data={data.shiftsAndDelivery}
              deliveryOverdueHours={data.antiTheftSettings.deliveryOverdueHours || 20}
            />
          )}
          {activeTab === 'controls' && (
            <AntiTheftControlsTab
              initialSettings={data.antiTheftSettings}
              onSaved={() => void commandCenterQuery.refetch()}
            />
          )}
        </>
      )}
    </div>
  );
}

const headerCardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '14px',
  padding: '16px 18px',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
};

const heroBadgeIconStyle: React.CSSProperties = {
  width: '44px',
  height: '44px',
  borderRadius: '12px',
  backgroundColor: '#eef2ff',
  color: '#170e5e',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const refreshBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '7px 12px',
  borderRadius: '8px',
  border: '1px solid #cbd5e1',
  backgroundColor: '#f8fafc',
  color: '#0f172a',
  fontSize: '12.5px',
  fontWeight: 600,
  cursor: 'pointer',
};

const kpiCardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '14px',
  padding: '14px 16px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
};

const kpiLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#64748b',
};

const kpiValueStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 800,
  color: '#0f172a',
  marginTop: '4px',
};

const kpiSubStyle: React.CSSProperties = {
  fontSize: '11.5px',
  color: '#64748b',
  marginTop: '4px',
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  padding: '10px',
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
};

const loadingBoxStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '14px',
  padding: '48px 16px',
  textAlign: 'center',
  color: '#64748b',
  fontSize: '13.5px',
};

const errorBoxStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #fecaca',
  borderRadius: '14px',
  padding: '36px 16px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
};
