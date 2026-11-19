import { TruckIcon, TrendingUpIcon } from '@/shared/components/icons/AppIcons';
import { formatMarketRoiBadge } from '../utils/import-display-formatters';

export interface FeasibilityResultsLogisticsProps {
  feasibilityResult: any;
}

export function FeasibilityResultsLogistics({ feasibilityResult }: FeasibilityResultsLogisticsProps) {
  return (
    <>
      {/* 1. Maritime Container Logistics & Utilization Card */}
      {feasibilityResult.containerMetrics && (
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: 10,
            padding: '12px 16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  backgroundColor: '#e0e7ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#170e5e',
                }}
              >
                <TruckIcon size={16} />
              </div>
              <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                التقييم اللوجستي للشحن واستيعاب الحاويات البحرية (لشركة الشحن الملاحي)
              </span>
            </div>

            <span
              style={{
                padding: '3px 10px',
                borderRadius: 6,
                fontSize: '11.5px',
                fontWeight: 700,
                backgroundColor: '#170e5e',
                color: '#ffffff',
              }}
            >
              نوع الحاوية: {feasibilityResult.containerMetrics.recommendedContainerType.toUpperCase()} (
              {feasibilityResult.containerMetrics.containerCountNeeded} حاوية)
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 10 }}>
            {/* Weight Metric */}
            <div style={{ backgroundColor: '#f8fafc', padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '10.5px', color: '#64748b' }}>إجمالي الوزن القائم</div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', margin: '2px 0' }}>
                {feasibilityResult.containerMetrics.totalGrossWeightTons} طن
              </div>
              <div style={{ width: '100%', height: 4, backgroundColor: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(100, feasibilityResult.containerMetrics.weightCapacityUtilizationPercent)}%`,
                    height: '100%',
                    backgroundColor:
                      feasibilityResult.containerMetrics.weightCapacityUtilizationPercent > 90 ? '#ef4444' : '#15803d',
                  }}
                />
              </div>
              <div style={{ fontSize: '9.5px', color: '#64748b', marginTop: 2 }}>
                {feasibilityResult.containerMetrics.weightCapacityUtilizationPercent}% من حمولة الطريق المسموحة (26 طن)
              </div>
            </div>

            {/* Volume Metric */}
            <div style={{ backgroundColor: '#f8fafc', padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '10.5px', color: '#64748b' }}>إجمالي الحجم المكعب</div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', margin: '2px 0' }}>
                {feasibilityResult.containerMetrics.totalVolumeCbm} CBM
              </div>
              <div style={{ width: '100%', height: 4, backgroundColor: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(100, feasibilityResult.containerMetrics.volumeCapacityUtilizationPercent)}%`,
                    height: '100%',
                    backgroundColor: '#2563eb',
                  }}
                />
              </div>
              <div style={{ fontSize: '9.5px', color: '#64748b', marginTop: 2 }}>
                {feasibilityResult.containerMetrics.volumeCapacityUtilizationPercent}% استيعاب الحجم للحاوية
              </div>
            </div>

            {/* Cargo Nature */}
            <div style={{ backgroundColor: '#f8fafc', padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '10.5px', color: '#64748b' }}>طبيعة الشحنة اللوجستية</div>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 800,
                  color: feasibilityResult.containerMetrics.isHeavyCargo ? '#b45309' : '#1e293b',
                  marginTop: 4,
                }}
              >
                {feasibilityResult.containerMetrics.isHeavyCargo
                  ? 'بضائع فائقة الوزن (مغلقة وزناً)'
                  : feasibilityResult.containerMetrics.isBulkyCargo
                  ? 'بضائع حجمية خفيفة'
                  : 'حمولة متوازنة وزناً وحجماً'}
              </div>
            </div>

            {/* Demurrage & Detention Buffer */}
            <div style={{ backgroundColor: '#f8fafc', padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '10.5px', color: '#64748b' }}>مخاطر تأخير الموانئ والأرضيات</div>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#059669', marginTop: 4 }}>
                فترة سماح معتادة: 14 - 21 يوم
              </div>
              <div style={{ fontSize: '9.5px', color: '#64748b', marginTop: 2 }}>
                محسوب احتياطي 15,000 ج.م بالسيناريو المتحفظ
              </div>
            </div>
          </div>

          <div
            style={{
              padding: '6px 12px',
              backgroundColor: '#f1f5f9',
              borderRadius: 6,
              fontSize: '11px',
              color: '#334155',
              lineHeight: 1.5,
            }}
          >
            <strong>التقرير الملاحي:</strong> {feasibilityResult.containerMetrics.loadSummaryAr}
          </div>
        </div>
      )}

      {/* 2. Local Market Arbitrage & Shop Profitability Card */}
      {feasibilityResult.totalProfitVsMarketEgp !== undefined && (
        <div
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 10,
            padding: '12px 16px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  backgroundColor: '#dcfce7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#15803d',
                }}
              >
                <TrendingUpIcon size={16} />
              </div>
              <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#166534' }}>
                مؤشرات ربحية السوق المصري والمحل التجاري (لتاجر ومستورد قطع الغيار)
              </span>
            </div>

            {(() => {
              // I2-P9: hide the badge when the engine reported no
              // market ROI (zero/negative market profit) — never
              // an empty "% ROI" with no number.
              const badge = formatMarketRoiBadge(feasibilityResult.overallRoiVsMarketPercent);
              return badge ? (
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: 6,
                    fontSize: '12px',
                    fontWeight: 800,
                    backgroundColor: '#15803d',
                    color: '#ffffff',
                  }}
                >
                  {badge}
                </span>
              ) : null;
            })()}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <div style={{ backgroundColor: '#ffffff', padding: '8px 12px', borderRadius: 6, border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: '10.5px', color: '#64748b' }}>إجمالي صافي أرباح الشحنة بأسعار السوق</div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#15803d', marginTop: 2 }}>
                {feasibilityResult.totalProfitVsMarketEgp.toLocaleString()} ج.م
              </div>
            </div>

            <div style={{ backgroundColor: '#ffffff', padding: '8px 12px', borderRadius: 6, border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: '10.5px', color: '#64748b' }}>إجمالي التكلفة الواصلة للمخزن / المحل</div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                {feasibilityResult.totalAccountingCostEgp.toLocaleString()} ج.م
              </div>
            </div>

            <div style={{ backgroundColor: '#ffffff', padding: '8px 12px', borderRadius: 6, border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: '10.5px', color: '#64748b' }}>السيولة النقدية المطلوبة للتمويل</div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e', marginTop: 2 }}>
                {feasibilityResult.totalProjectInvestmentEgp.toLocaleString()} ج.م
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
