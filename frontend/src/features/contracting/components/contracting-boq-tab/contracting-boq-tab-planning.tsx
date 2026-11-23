import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { useNavigate } from 'react-router-dom';

export interface ContractingBoqTabPlanningProps {
  projectStatus?: string;
  t: ReturnType<typeof useTranslation>['t'];
  navigate: ReturnType<typeof useNavigate>;
  projectId?: string;
  onAwardProject?: () => void;
}

export function ContractingBoqTabPlanning({ projectStatus, t, navigate, projectId, onAwardProject }: ContractingBoqTabPlanningProps) {
  return (
    <>
    {projectStatus === 'planning' && (
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRight: '4px solid #170e5e',
          borderRadius: '10px',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '14px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: '280px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '8px',
              background: '#e0e7ff',
              color: '#170e5e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <AppIcons.FileCheck size={20} />
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{t('contracting.contracting_boq_tab.s7', "هذا المشروع مسجل كـ «عطاء قيد الدراسة والتسعير (Planning)»")}</span>
              <span style={{ fontSize: '10.5px', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '1px 8px', borderRadius: '4px', color: '#1e40af', fontWeight: 600 }}>
                {t('contracting.contracting_boq_tab.s8', "عطاء استرشادي")}
              </span>
            </div>
            <div style={{ fontSize: 'var(--font-subtitle)', color: '#475569', marginTop: '3px' }}>
              {t('contracting.contracting_boq_tab.s9', "بنود المقايسة وتكاليفها هنا هي دراسة تقديرية. تظل نسب الإنجاز والتنفيذ 0% تلقائياً حتى الترسية والبدء الميداني.")}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => navigate(`/contracting/tender?projectId=${projectId}`)}
            style={{
              height: '34px',
              padding: '0 14px',
              borderRadius: '6px',
              fontWeight: 700,
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
              fontSize: 'var(--font-badge)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 3px rgba(23, 14, 94, 0.15)',
            }}
          >
            <AppIcons.Sliders size={14} />
            <span>{t('contracting.contracting_boq_tab.s10', "العودة لدراسة وتسعير العطاء (المرحلة 1)")}</span>
          </button>
          {onAwardProject && (
            <button
              type="button"
              onClick={onAwardProject}
              style={{
                height: '34px',
                padding: '0 14px',
                borderRadius: '6px',
                fontWeight: 700,
                background: '#15803d',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                fontSize: 'var(--font-badge)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 1px 3px rgba(21, 128, 61, 0.15)',
              }}
            >
              <AppIcons.CheckCircle size={14} />
              <span>{t('contracting.contracting_boq_tab.s11', "اعتماد وترسية العطاء كمشروع ساري")}</span>
            </button>
          )}
        </div>
      </div>
    )}
    </>
  );
}
