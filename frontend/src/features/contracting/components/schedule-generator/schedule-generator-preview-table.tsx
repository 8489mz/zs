import { useTranslation } from 'react-i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction } from 'react';
import type { GeneratedTaskPreview, ProjectScope } from './schedule-generator-data';

interface ScheduleGeneratorPreviewTableProps {
  previewTasks: GeneratedTaskPreview[];
  customTasks: GeneratedTaskPreview[] | null;
  setCustomTasks: Dispatch<SetStateAction<GeneratedTaskPreview[] | null>>;
  handleScopeChange: (scope: ProjectScope) => void;
  handleTaskNameChange: (index: number, newName: string) => void;
  handleTaskDurationChange: (index: number, newDuration: number) => void;
}

export function ScheduleGeneratorPreviewTable({ previewTasks, customTasks, setCustomTasks, handleScopeChange, handleTaskNameChange, handleTaskDurationChange }: ScheduleGeneratorPreviewTableProps) {
  const { t: __t } = useTranslation();
  return (
    <>
    {/* Live Schedule Preview Table */}
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h4 style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#1e293b', margin: 0 }}>
            {__t('contracting.schedule_generator_modal.s34', "معاينة الجدول الزمني المولد (")}{previewTasks.length} {__t('contracting.schedule_generator_modal.s35', "نشاط ومرحلة)")}
          </h4>
          {customTasks !== null && (
            <button
              type="button"
              onClick={() => setCustomTasks(null)}
              title={__t('contracting.schedule_generator_modal.s36', "استعادة مدد وتواريخ القالب القياسي الافتراضية")}
              style={{
                fontSize: 'var(--font-micro)',
                color: '#170e5e',
                background: '#e0e7ff',
                border: '1px solid #c7d2fe',
                borderRadius: '6px',
                padding: '3px 8px',
                cursor: 'pointer',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <AppIcons.RefreshCw size={11} />
              <span>{__t('contracting.schedule_generator_modal.s37', "إعادة ضبط المدد للقالب")}</span>
            </button>
          )}
        </div>
        <span style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
          {__t('contracting.schedule_generator_modal.s38', "تاريخ الانتهاء المتوقع للمشروع:")} <strong style={{ color: '#170e5e', fontSize: '13px' }}>{previewTasks[previewTasks.length - 1]?.endDate || '-'}</strong>
        </span>
      </div>

      {previewTasks.length === 0 ? (
        <div style={{ border: '1px dashed #cbd5e1', borderRadius: '8px', padding: '32px', textAlign: 'center', backgroundColor: '#f8fafc' }}>
          <AppIcons.AlertTriangle size={32} style={{ color: '#b45309', margin: '0 auto 8px' }} />
          <div style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {__t('contracting.schedule_generator_modal.s39', "لم يتم تحديد أي حزمة أعمال حالياً")}
          </div>
          <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', marginBottom: '12px' }}>
            {__t('contracting.schedule_generator_modal.s40', "يرجى اختيار أحد القوالب التخصصية من القائمة أعلاه، أو تفعيل حزمة واحدة على الأقل لتوليد جدولها الزمني.")}
          </div>
          <button
            type="button"
            onClick={() => handleScopeChange('full_turnkey')}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: '#170e5e',
              color: '#ffffff',
              fontSize: 'var(--font-body)',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {__t('contracting.schedule_generator_modal.s41', "استعادة القالب المتكامل (تسليم مفتاح)")}
          </button>
        </div>
      ) : (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', maxHeight: '340px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', color: '#475569', width: '80px', textAlign: 'center' }}>WBS</th>
                <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', color: '#475569', width: '170px' }}>{__t('contracting.schedule_generator_modal.s42', "الحزمة الإنشائية")}</th>
                <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{__t('contracting.schedule_generator_modal.s43', "بيان النشاط والمرحلة")}</th>
                <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', color: '#475569', width: '95px', textAlign: 'center' }}>{__t('contracting.schedule_generator_modal.s44', "البداية")}</th>
                <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', color: '#475569', width: '95px', textAlign: 'center' }}>{__t('contracting.schedule_generator_modal.s45', "النهاية")}</th>
                <th style={{ padding: '8px 6px', fontSize: 'var(--font-table-head)', color: '#170e5e', width: '100px', textAlign: 'center' }}>{__t('contracting.schedule_generator_modal.s46', "المدة (تعديل)")}</th>
                <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', color: '#475569', width: '80px', textAlign: 'center' }}>{__t('contracting.schedule_generator_modal.s47', "المسار")}</th>
              </tr>
            </thead>
            <tbody>
              {previewTasks.map((t, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                  <td style={{ padding: '8px 10px', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#170e5e', textAlign: 'center' }}>
                    {t.wbsCode}
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: 'var(--font-micro)' }}>
                    <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: '#f1f5f9', color: '#475569', fontWeight: 600 }}>
                      {t.category}
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px', fontSize: 'var(--font-body)', fontWeight: 600, color: '#1e293b' }}>
                    <input
                      type="text"
                      value={t.taskName}
                      onChange={(e) => handleTaskNameChange(idx, e.target.value)}
                      title={__t('contracting.schedule_generator_modal.s48', "انقر لتعديل مسمى النشاط")}
                      style={{
                        width: '100%',
                        height: '28px',
                        padding: '0 6px',
                        border: '1px solid transparent',
                        borderRadius: '4px',
                        background: 'transparent',
                        fontSize: 'var(--font-body)',
                        fontWeight: 600,
                        color: '#1e293b',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = '#cbd5e1';
                        e.target.style.background = '#ffffff';
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = 'transparent';
                        e.target.style.background = 'transparent';
                      }}
                    />
                  </td>
                  <td style={{ padding: '8px 8px', fontSize: 'var(--font-micro)', color: '#64748b', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {t.startDate}
                  </td>
                  <td style={{ padding: '8px 8px', fontSize: 'var(--font-micro)', color: '#64748b', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {t.endDate}
                  </td>
                  <td style={{ padding: '4px 6px', textAlign: 'center', verticalAlign: 'middle' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={t.durationDays}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val) && val >= 1) {
                            handleTaskDurationChange(idx, val);
                          }
                        }}
                        title={__t('contracting.schedule_generator_modal.s49', "انقر لتعديل مدة النشاط باليوم وترحيل باقي تواريخ الجدول تلقائياً")}
                        style={{
                          width: '50px',
                          height: '28px',
                          padding: '0 4px',
                          textAlign: 'center',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          fontSize: 'var(--font-body)',
                          fontWeight: 700,
                          color: '#170e5e',
                          background: '#ffffff',
                          outline: 'none',
                          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)',
                        }}
                      />
                      <span style={{ fontSize: 'var(--font-micro)', fontWeight: 600, color: '#64748b' }}>{__t('contracting.schedule_generator_modal.s50', "يوم")}</span>
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: 'var(--font-micro)', textAlign: 'center' }}>
                    {t.isCriticalPath ? (
                      <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: '#fee2e2', color: '#991b1b', fontWeight: 700 }}>
                        {__t('contracting.schedule_generator_modal.s51', "حرج CPM")}
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>{__t('contracting.schedule_generator_modal.s52', "عادي")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </>
  );
}
