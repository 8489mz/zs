import type { useTranslation } from 'react-i18next';

export interface ContractingBoqTabStatsProps {
  t: ReturnType<typeof useTranslation>['t'];
  totalContractValue: number;
  currencySymbol: string;
  totalEstimatedCost: number;
  plannedMargin: number;
  overallProgress: number;
}

export function ContractingBoqTabStats({ t, totalContractValue, currencySymbol, totalEstimatedCost, plannedMargin, overallProgress }: ContractingBoqTabStatsProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px' }}>
        <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.contracting_boq_tab.s12', "إجمالي قيمة جدول الكميات")}</div>
        <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', marginTop: '2px', display: 'flex', alignItems: 'baseline', gap: '4px' }}>
          <span>{Math.round(totalContractValue).toLocaleString('en-US')}</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>{currencySymbol}</span>
        </div>
      </div>
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px' }}>
        <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.contracting_boq_tab.s13', "التكلفة التقديرية المستهدفة")}</div>
        <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', marginTop: '2px', display: 'flex', alignItems: 'baseline', gap: '4px' }}>
          <span>{Math.round(totalEstimatedCost).toLocaleString('en-US')}</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>{currencySymbol}</span>
        </div>
      </div>
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px' }}>
        <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.contracting_boq_tab.s14', "هامش الربح المخطط")}</div>
        <div style={{ fontSize: '1.25rem', fontWeight: 800, color: plannedMargin >= 0 ? '#15803d' : '#b91c1c', marginTop: '2px' }}>
          {plannedMargin.toFixed(1)}%
        </div>
      </div>
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px' }}>
        <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.contracting_boq_tab.s15', "نسبة الإنجاز المالي المحقق")}</div>
        <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#170e5e', marginTop: '2px' }}>
          {overallProgress.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}
