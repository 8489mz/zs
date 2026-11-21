import type { TFunction } from 'i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';

export interface TenderMrpSummaryProps {
  tenderSummary: {
    totalSellingPrice: number;
    totalDirectCost: number;
    totalTenderCost: number;
    totalProfit: number;
    overallMargin: number;
    resources: { name: string; unit: string; type: string; totalQty: number; totalCost: number }[];
  };
  t: TFunction;
  formatCurrency: (val: number | string | undefined | null) => string;
}

export function TenderMrpSummary({ tenderSummary, t, formatCurrency }: TenderMrpSummaryProps) {
  return (
    <>
      {tenderSummary.resources.length > 0 && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AppIcons.Layers size={15} />
            <span>{t('contracting.tender_estimator_modal.s70', "إجمالي الموارد والخامات التقديرية لتنفيذ العطاء بالكامل (Pre-Procurement Materials Takeoff)")}</span>
          </h4>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
              gap: '8px',
              padding: '2px',
            }}
          >
            {tenderSummary.resources.map((res) => (
              <div key={res.name} style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 10px' }}>
                <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={res.name}>
                  {res.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: '2px' }}>
                  <strong style={{ fontSize: 'var(--font-body)', color: '#170e5e', fontWeight: 800 }} dir="ltr">
                    {res.totalQty.toLocaleString()} <span style={{ fontSize: 'var(--font-micro)', fontWeight: 600, color: '#64748b' }}>{res.unit}</span>
                  </strong>
                </div>
                <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>
                  {t('contracting.tender_estimator_modal.s71', "تقديري:")} <strong>{formatCurrency(res.totalCost)}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
