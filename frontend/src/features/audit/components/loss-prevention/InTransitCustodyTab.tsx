import { formatCurrency, formatDateTimeArabic } from '@/lib/format';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { AlertTriangleIcon, CheckCircleIcon, TruckIcon } from '@/shared/components/icons/AppIcons';
import type { CommandCenterResponse } from '../../api/cashier-fraud-radar.api';

interface Props {
  data: CommandCenterResponse['inTransitCustody'];
}

export function InTransitCustodyTab({ data }: Props) {
  return (
    <div style={cardStyle}>
      <div style={headerRowStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={navyBarStyle} />
          <div>
            <h3 style={titleStyle}>عهدة الناقلين والبضاعة بالطريق (In-Transit Custody)</h3>
            <div style={subStyle}>
              كافة أذون التحويل المصروفة من المخازن ولم يُؤكد استلامها الفعلي بعد — مهلة الإنذار الحالية: {data.alertThresholdHours} ساعة
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12.5px' }}>
          <span style={metricPillStyle}>
            أذون مفتوحة: <strong>{data.openCount}</strong>
          </span>
          <span
            style={{
              ...metricPillStyle,
              backgroundColor: data.overdueCount > 0 ? '#fef2f2' : '#f0fdf4',
              color: data.overdueCount > 0 ? '#b91c1c' : '#15803d',
              borderColor: data.overdueCount > 0 ? '#fecaca' : '#bbf7d0',
            }}
          >
            متأخرة بالطريق: <strong>{data.overdueCount}</strong>
          </span>
          <span style={metricPillStyle}>
            التكلفة المعلقة: <strong>{formatCurrency(data.totalEstimatedCost)}</strong> <CurrencySymbol />
          </span>
        </div>
      </div>

      {data.transfers.length === 0 ? (
        <div style={emptyStyle}>
          <CheckCircleIcon size={28} color="#16a34a" />
          <div style={{ fontWeight: 700, color: '#0f172a', marginTop: '8px' }}>
            لا توجد بضاعة معلقة بالطريق حالياً — كافة التحويلات مستلمة ومطابقة
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>رقم الإذن</th>
                <th style={thStyle}>المسار (من ← إلى)</th>
                <th style={thStyle}>الناقل / حامل العهدة</th>
                <th style={thStyle}>أصدره</th>
                <th style={thStyle}>الأصناف / الكمية</th>
                <th style={thStyle}>التكلفة التقديرية</th>
                <th style={thStyle}>المدة المنقضية</th>
                <th style={thStyle}>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {data.transfers.map((tr) => (
                <tr
                  key={tr.transferId}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    backgroundColor: tr.isOverdue ? '#fff5f5' : '#ffffff',
                  }}
                >
                  <td style={{ ...tdStyle, fontWeight: 700, color: '#170e5e' }}>{tr.docNo}</td>
                  <td style={tdStyle}>
                    {tr.fromLocationName} ← {tr.toLocationName}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>
                    {tr.carrierName || <span style={{ color: '#94a3b8' }}>غير محدد</span>}
                  </td>
                  <td style={tdStyle}>
                    <div>{tr.createdByName || '—'}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      {tr.createdAt ? formatDateTimeArabic(tr.createdAt) : ''}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    {tr.itemsCount} صنف ({tr.totalQty})
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>
                    {formatCurrency(tr.estimatedCost)} <CurrencySymbol />
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: tr.isOverdue ? '#b91c1c' : '#334155' }}>
                    {tr.ageHours} ساعة
                  </td>
                  <td style={tdStyle}>
                    {tr.isOverdue ? (
                      <span style={{ ...badgeStyle, backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
                        <AlertTriangleIcon size={12} /> متأخر (+{tr.overdueByHours} س)
                      </span>
                    ) : (
                      <span style={{ ...badgeStyle, backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
                        <TruckIcon size={12} /> قيد التوصيل
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '14px',
  padding: '16px',
};

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  marginBottom: '14px',
};

const navyBarStyle: React.CSSProperties = {
  width: '3px',
  height: '20px',
  borderRadius: '2px',
  backgroundColor: '#170e5e',
  display: 'inline-block',
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '15px',
  fontWeight: 700,
  color: '#0f172a',
};

const subStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#64748b',
  marginTop: '2px',
};

const metricPillStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: '8px',
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  color: '#334155',
};

const emptyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px 16px',
  textAlign: 'center',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
};

const thStyle: React.CSSProperties = {
  textAlign: 'right',
  padding: '9px 12px',
  backgroundColor: '#f8fafc',
  color: '#475569',
  fontSize: '12px',
  fontWeight: 600,
  borderBottom: '1px solid #e2e8f0',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  color: '#1e293b',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  padding: '3px 9px',
  borderRadius: '9999px',
  fontSize: '11.5px',
  fontWeight: 600,
};
