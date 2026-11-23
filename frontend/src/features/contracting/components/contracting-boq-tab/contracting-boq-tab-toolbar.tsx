import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';

export interface ContractingBoqTabToolbarProps {
  t: ReturnType<typeof useTranslation>['t'];
  setIsAutoPricingOpen: React.Dispatch<React.SetStateAction<boolean>>;
  projectId?: string;
  setIsProfitabilityOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsIndirectCostOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSnapshotOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function ContractingBoqTabToolbar({ t, setIsAutoPricingOpen, projectId, setIsProfitabilityOpen, setIsIndirectCostOpen, setIsSnapshotOpen }: ContractingBoqTabToolbarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        flexWrap: 'wrap',
        background: '#ffffff',
        padding: '8px 14px',
        borderRadius: '10px',
        border: '1px solid #e2e8f0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--font-micro)', fontWeight: 700, color: '#475569', marginInlineEnd: '4px' }}>
          {t('contracting.contracting_boq_tab.s16', "أدوات المقايسة المتقدمة:")}
        </span>

        {/* محرك التسعير الهندسي */}
        <button
          type="button"
          onClick={() => setIsAutoPricingOpen(true)}
          style={{
            height: '32px',
            padding: '0 12px',
            borderRadius: '6px',
            fontWeight: 600,
            background: '#ffffff',
            color: '#334155',
            border: '1px solid #cbd5e1',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
            fontSize: 'var(--font-body)',
            transition: 'all 0.15s ease',
          }}
        >
          <AppIcons.Calculator size={14} />
          <span>{t('contracting.contracting_boq_tab.s17', "محرك التسعير الآلي")}</span>
        </button>

        {/* تحليل ربحية البنود */}
        {projectId && (
          <button
            type="button"
            onClick={() => setIsProfitabilityOpen(true)}
            style={{
              height: '32px',
              padding: '0 12px',
              borderRadius: '6px',
              fontWeight: 600,
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: 'var(--font-body)',
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.TrendingUp size={14} />
            <span>{t('contracting.contracting_boq_tab.s18', "تحليل أرباح وخسائر البنود")}</span>
          </button>
        )}

        {/* محرك توزيع المصاريف غير المباشرة */}
        {projectId && (
          <button
            type="button"
            onClick={() => setIsIndirectCostOpen(true)}
            style={{
              height: '32px',
              padding: '0 12px',
              borderRadius: '6px',
              fontWeight: 600,
              background: '#eff6ff',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: 'var(--font-body)',
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.Sliders size={14} />
            <span>{t('contracting.contracting_boq_tab.s19', "توزيع غير المباشر (AACE)")}</span>
          </button>
        )}

        {/* تجميد خط الأساس */}
        {projectId && (
          <button
            type="button"
            onClick={() => setIsSnapshotOpen(true)}
            style={{
              height: '32px',
              padding: '0 12px',
              borderRadius: '6px',
              fontWeight: 600,
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: 'var(--font-body)',
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.Lock size={14} />
            <span>{t('contracting.contracting_boq_tab.s20', "تجميد خط الأساس (Baseline Lock)")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
