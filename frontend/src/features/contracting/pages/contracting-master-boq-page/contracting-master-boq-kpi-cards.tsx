import type { useTranslation } from 'react-i18next';

export interface ContractingMasterBoqKpiCardsProps {
  __t: ReturnType<typeof useTranslation>['t'];
  totalItemsCount: number;
  totalTradesCount: number;
  customItemsCount: number;
  avgMargin: number;
}

export function ContractingMasterBoqKpiCards({ __t, totalItemsCount, totalTradesCount, customItemsCount, avgMargin }: ContractingMasterBoqKpiCardsProps) {
  return (
    <>
    {/* بطاقات المؤشرات العامة (Enterprise KPI Summary) */}
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '14px',
        marginBottom: '16px',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '16px 20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '88px',
        }}
      >
        <div style={{ fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#64748b' }}>
          {__t('contracting.contracting_master_boq_page.s5', "إجمالي البنود بالبنك")}
        </div>
        <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span>{totalItemsCount.toLocaleString('en-US')}</span>
          <span style={{ fontSize: 'var(--font-micro)', fontWeight: 500, color: '#64748b' }}>{__t('contracting.contracting_master_boq_page.s6', "بند معتمد")}</span>
        </div>
      </div>

      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '16px 20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '88px',
        }}
      >
        <div style={{ fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#64748b' }}>
          {__t('contracting.contracting_master_boq_page.s7', "التخصصات الإنشائية")}
        </div>
        <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#170e5e', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span>{totalTradesCount}</span>
          <span style={{ fontSize: 'var(--font-micro)', fontWeight: 500, color: '#64748b' }}>{__t('contracting.contracting_master_boq_page.s8', "تخصص هندسي")}</span>
        </div>
      </div>

      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '16px 20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '88px',
        }}
      >
        <div style={{ fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#64748b' }}>
          {__t('contracting.contracting_master_boq_page.s9', "بنود الشركة المخصصة")}
        </div>
        <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1e40af', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span>{customItemsCount.toLocaleString('en-US')}</span>
          <span style={{ fontSize: 'var(--font-micro)', fontWeight: 500, color: '#64748b' }}>{__t('contracting.contracting_master_boq_page.s10', "بند مخصص")}</span>
        </div>
      </div>

      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '16px 20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '88px',
        }}
      >
        <div style={{ fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#64748b' }}>
          {__t('contracting.contracting_master_boq_page.s11', "متوسط هامش الربح المرجعي")}
        </div>
        <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10b981', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span>{avgMargin}%</span>
          <span style={{ fontSize: 'var(--font-micro)', fontWeight: 500, color: '#64748b' }}>{__t('contracting.contracting_master_boq_page.s12', "تقديري")}</span>
        </div>
      </div>
    </div>
    </>
  );
}
