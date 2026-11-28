import { formatCurrency, formatDateTimeArabic } from '@/lib/format';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { AlertTriangleIcon, CheckCircleIcon, CreditCardIcon, TruckIcon } from '@/shared/components/icons/AppIcons';
import type { CommandCenterResponse } from '../../api/cashier-fraud-radar.api';

interface Props {
  data: CommandCenterResponse['shiftsAndDelivery'];
  deliveryOverdueHours: number;
}

export function ShiftsAndDeliveryCustodyTab({ data, deliveryOverdueHours }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. Shift Cash Variances */}
      <div style={cardStyle}>
        <div style={headerRowStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={navyBarStyle} />
            <div>
              <h3 style={titleStyle}>فروقات وعجز ورديات الكاشير</h3>
              <div style={subStyle}>
                كافة الورديات المغلقة التي سجّلت عجزاً أو زيادة نقدية مقارنة بالنقدية المتوقعة في الدرج
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '12.5px' }}>
            <span style={pillStyle}>
              ورديات بعجز: <strong>{data.shortageShiftsCount}</strong>
            </span>
            <span
              style={{
                ...pillStyle,
                backgroundColor: data.totalShiftShortageAmount > 0 ? '#fef2f2' : '#f0fdf4',
                color: data.totalShiftShortageAmount > 0 ? '#b91c1c' : '#15803d',
                borderColor: data.totalShiftShortageAmount > 0 ? '#fecaca' : '#bbf7d0',
              }}
            >
              إجمالي العجز: <strong>{formatCurrency(data.totalShiftShortageAmount)}</strong> <CurrencySymbol />
            </span>
          </div>
        </div>

        {data.shiftVariances.length === 0 ? (
          <div style={emptyStyle}>
            <CheckCircleIcon size={26} color="#16a34a" />
            <div style={{ fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
              جميع ورديات الكاشير مطابقة تماماً دون عجز أو فروقات خلال هذه الفترة
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>رقم الوردية</th>
                  <th style={thStyle}>الكاشير</th>
                  <th style={thStyle}>الجهاز</th>
                  <th style={thStyle}>المتوقع بالدرج</th>
                  <th style={thStyle}>الفعلي المعدود</th>
                  <th style={thStyle}>الفارق</th>
                  <th style={thStyle}>المعالجة</th>
                  <th style={thStyle}>وقت الإغلاق</th>
                </tr>
              </thead>
              <tbody>
                {data.shiftVariances.map((sh) => {
                  const isShortage = sh.variance < -0.01;
                  return (
                    <tr
                      key={sh.shiftId}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        backgroundColor: isShortage ? '#fff5f5' : '#ffffff',
                      }}
                    >
                      <td style={{ ...tdStyle, fontWeight: 700, color: '#170e5e' }}>{sh.docNo}</td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{sh.cashierName}</td>
                      <td style={tdStyle}>{sh.terminalCode}</td>
                      <td style={tdStyle}>
                        {formatCurrency(sh.expectedCash)} <CurrencySymbol />
                      </td>
                      <td style={tdStyle}>
                        {formatCurrency(sh.countedCash)} <CurrencySymbol />
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          fontWeight: 800,
                          color: isShortage ? '#b91c1c' : '#15803d',
                        }}
                      >
                        {sh.variance > 0 ? `+${formatCurrency(sh.variance)}` : formatCurrency(sh.variance)}{' '}
                        <CurrencySymbol />
                      </td>
                      <td style={tdStyle}>
                        {sh.varianceResolution === 'charge_cashier'
                          ? 'خصم على الكاشير'
                          : sh.varianceResolution === 'store_expense'
                            ? 'تحمّل المنشأة'
                            : sh.varianceResolution || 'قيد المراجعة'}
                      </td>
                      <td style={{ ...tdStyle, fontSize: '12px', color: '#64748b' }}>
                        {sh.closedAt ? formatDateTimeArabic(sh.closedAt) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 2. Delivery Reps Unsettled Cash Custodies & Overdue Orders */}
      <div style={cardStyle}>
        <div style={headerRowStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={navyBarStyle} />
            <div>
              <h3 style={titleStyle}>عهد مناديب التوصيل والطلبات المتأخرة عن التسوية</h3>
              <div style={subStyle}>
                المبالغ النقدية المعلقة لدى المناديب وطلبات الدفع عند الاستلام التي تجاوزت {deliveryOverdueHours} ساعة بدون تصفية
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '12.5px' }}>
            <span style={pillStyle}>
              إجمالي العهد المعلقة: <strong>{formatCurrency(data.totalUnsettledDeliveryCash)}</strong> <CurrencySymbol />
            </span>
            <span
              style={{
                ...pillStyle,
                backgroundColor: data.overdueDeliveryOrdersCount > 0 ? '#fef2f2' : '#f0fdf4',
                color: data.overdueDeliveryOrdersCount > 0 ? '#b91c1c' : '#15803d',
                borderColor: data.overdueDeliveryOrdersCount > 0 ? '#fecaca' : '#bbf7d0',
              }}
            >
              طلبات متأخرة (+{deliveryOverdueHours} س): <strong>{data.overdueDeliveryOrdersCount}</strong>
            </span>
          </div>
        </div>

        {data.deliveryCustodies.length === 0 ? (
          <div style={emptyStyle}>
            <TruckIcon size={26} color="#16a34a" />
            <div style={{ fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
              لا توجد عهد معلقة أو متأخرة لدى مناديب التوصيل حالياً
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>المندوب</th>
                  <th style={thStyle}>الهاتف</th>
                  <th style={thStyle}>الطلبات غير المسوّاة</th>
                  <th style={thStyle}>المتأخرة (+{deliveryOverdueHours} س)</th>
                  <th style={thStyle}>العهدة النقدية المعلقة</th>
                  <th style={thStyle}>السقف المخصص</th>
                  <th style={thStyle}>أقدم طلب معلق</th>
                  <th style={thStyle}>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {data.deliveryCustodies.map((rep) => {
                  const hasAlert = rep.overdueOrdersCount > 0 || rep.isOverCap;
                  return (
                    <tr
                      key={rep.repId}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        backgroundColor: hasAlert ? '#fff5f5' : '#ffffff',
                      }}
                    >
                      <td style={{ ...tdStyle, fontWeight: 700, color: '#0f172a' }}>{rep.repName}</td>
                      <td style={tdStyle}>{rep.phone || '—'}</td>
                      <td style={tdStyle}>{rep.unsettledOrdersCount}</td>
                      <td
                        style={{
                          ...tdStyle,
                          fontWeight: 700,
                          color: rep.overdueOrdersCount > 0 ? '#b91c1c' : '#334155',
                        }}
                      >
                        {rep.overdueOrdersCount}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 800, color: '#0f172a' }}>
                        {formatCurrency(rep.unsettledCash)} <CurrencySymbol />
                      </td>
                      <td style={tdStyle}>
                        {rep.custodyCap > 0 ? (
                          <>
                            {formatCurrency(rep.custodyCap)} <CurrencySymbol />
                          </>
                        ) : (
                          <span style={{ color: '#64748b', fontSize: '12px' }}>مفتوح (مقيّد بالزمن فقط)</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontSize: '12px', color: '#64748b' }}>
                        {rep.oldestUnsettledAt ? formatDateTimeArabic(rep.oldestUnsettledAt) : '—'}
                      </td>
                      <td style={tdStyle}>
                        {rep.overdueOrdersCount > 0 ? (
                          <span style={dangerBadgeStyle}>
                            <AlertTriangleIcon size={12} /> عهدة متأخرة
                          </span>
                        ) : rep.isOverCap ? (
                          <span style={dangerBadgeStyle}>
                            <CreditCardIcon size={12} /> تجاوز السقف
                          </span>
                        ) : (
                          <span style={okBadgeStyle}>ضمن المهلة</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
  marginBottom: '12px',
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

const pillStyle: React.CSSProperties = {
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
  padding: '28px 16px',
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

const dangerBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  padding: '3px 9px',
  borderRadius: '9999px',
  fontSize: '11.5px',
  fontWeight: 600,
  backgroundColor: '#fef2f2',
  color: '#b91c1c',
  border: '1px solid #fecaca',
};

const okBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 9px',
  borderRadius: '9999px',
  fontSize: '11.5px',
  fontWeight: 600,
  backgroundColor: '#f0fdf4',
  color: '#15803d',
  border: '1px solid #bbf7d0',
};
