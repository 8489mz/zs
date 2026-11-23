import { formatCurrency } from '@/lib/format';
import type { CustomsBroker } from '../api/shipments.api';

export interface CustomsBrokerTableProps {
  brokers: CustomsBroker[];
  setSelectedBrokerForStatement: React.Dispatch<React.SetStateAction<CustomsBroker | null>>;
}

export function CustomsBrokerTable({ brokers, setSelectedBrokerForStatement }: CustomsBrokerTableProps) {
  return (
    <>
    {/* Brokers Table */}
    <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>
            <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>اسم المخلص / المكتب</th>
            <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>رقم الرخصة</th>
            <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>الميناء الرئيسي</th>
            <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>الهاتف</th>
            <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>إجمالي المنصرف (عهد)</th>
            <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>المصروفات المصفاة</th>
            <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>الرصيد المتبقي طرفه</th>
            <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600, textAlign: 'center' }}>الإجراءات</th>
          </tr>
        </thead>
        <tbody>
          {brokers.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
                لا يوجد مخلصون جمركيون مسجلون حالياً. انقر على "إضافة مخلص جمركي" للبدء.
              </td>
            </tr>
          ) : (
            brokers.map((broker: any) => (
              <tr key={broker.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0f172a' }}>{broker.name}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace' }}>{broker.license_number || '—'}</td>
                <td style={{ padding: '10px 14px' }}>{broker.port_name}</td>
                <td style={{ padding: '10px 14px', direction: 'ltr', textAlign: 'right' }}>{broker.phone || '—'}</td>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{formatCurrency(broker.total_advances_egp)}</td>
                <td style={{ padding: '10px 14px', color: '#15803d', fontWeight: 600 }}>
                  {formatCurrency(broker.total_liquidated_egp)}
                </td>
                <td
                  style={{
                    padding: '10px 14px',
                    fontWeight: 800,
                    color: Number(broker.unliquidated_balance_egp) > 0 ? '#b91c1c' : '#15803d',
                  }}
                >
                  {formatCurrency(broker.unliquidated_balance_egp)}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedBrokerForStatement(broker)}
                    style={{
                      padding: '4px 10px',
                      backgroundColor: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      borderRadius: 4,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      color: '#170e5e',
                    }}
                  >
                    كشف حساب العهدة
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
    </>
  );
}
