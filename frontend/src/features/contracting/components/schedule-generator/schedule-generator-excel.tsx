import { useTranslation } from 'react-i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';

interface ScheduleGeneratorExcelProps {
  handleImportExcelSample: () => void;
}

export function ScheduleGeneratorExcel({ handleImportExcelSample }: ScheduleGeneratorExcelProps) {
  const { t: __t } = useTranslation();
  return (
    <div style={{ padding: '24px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px dashed #cbd5e1', textAlign: 'center' }}>
      <AppIcons.FileText size={40} style={{ color: '#170e5e', margin: '0 auto 12px' }} />
      <h3 style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#1e293b', margin: '0 0 6px' }}>
        {__t('contracting.schedule_generator_modal.s10', "استيراد بيانات الجدول الزمني من ملف إكسيل")}
      </h3>
      <p style={{ fontSize: 'var(--font-body)', color: '#64748b', maxWidth: '540px', margin: '0 auto 16px' }}>
        {__t('contracting.schedule_generator_modal.s11', "يمكنك استيراد ملف إكسيل للجدول الزمني أو تطبيق القالب الإنشائي الميداني القياسي (حفر وأساسات + هيكل خرساني + تشطيبات متكاملة).")}
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
        <button
          type="button"
          onClick={handleImportExcelSample}
          style={{
            padding: '8px 20px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: '#170e5e',
            color: '#ffffff',
            fontSize: 'var(--font-body)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {__t('contracting.schedule_generator_modal.s12', "تطبيق القالب الإنشائي القياسي")}
        </button>
      </div>
    </div>
  );
}
