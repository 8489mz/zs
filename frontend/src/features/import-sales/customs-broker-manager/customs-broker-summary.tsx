import { formatCurrency } from '@/lib/format';
import { CheckCircleIcon, RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import type { CustomsBroker } from '../api/shipments.api';

export interface CustomsBrokerSummaryProps {
  totalUnliquidatedAll: number;
  brokers: CustomsBroker[];
}

export function CustomsBrokerSummary({ totalUnliquidatedAll, brokers }: CustomsBrokerSummaryProps) {
  return (
    <>
    {/* Top KPI Cards */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginBottom: '8px' }}>
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>إجمالي العهد المعلقة طرف المخلصين</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: totalUnliquidatedAll > 0 ? '#b91c1c' : '#15803d', marginTop: '4px' }}>
            {formatCurrency(totalUnliquidatedAll)}
          </div>
        </div>
        <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#fee2e2', border: '1px solid #fecaca', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b91c1c' }}>
          <RefreshCwIcon size={20} />
        </div>
      </div>

      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>عدد المخلصين الجمركيين المعتمدين</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
            {brokers.length} <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>مخلص</span>
          </div>
        </div>
        <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#eff6ff', border: '1px solid #dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1e40af' }}>
          <CheckCircleIcon size={20} />
        </div>
      </div>
    </div>
    </>
  );
}
