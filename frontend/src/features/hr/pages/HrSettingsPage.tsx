import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';

import { QueryFeedback } from '@/shared/components/query-feedback';
import { Button } from '@/shared/ui/button';
import { DataTable } from '@/shared/ui/data-table';
import { getErrorMessage } from '@/lib/errors';
import { useHrLeaveTypes, useHrMutations, useHrWorkspace } from '@/features/hr/hooks/useHr';
import { HrSettingsHealthSummaryCard } from '@/features/hr/pages/settings/HrSettingsHealthSummaryCard';
import { HrSettingsOrganizationSection } from '@/features/hr/pages/settings/HrSettingsOrganizationSection';
import {
  HrSettingsAttendanceSection,
  HrSettingsDocumentsSection,
  HrSettingsPayrollSection,
  HrSettingsHolidaysSection,
} from '@/features/hr/pages/settings/HrSettingsStaticSections';
import { CalendarIcon } from '@/features/hr/components/HrIcons';
import { normalize, paidLabel, stats, statusLabel, text, toId } from '@/features/hr/pages/settings/hr-settings.helpers';

type MasterKind = 'departments' | 'job-titles' | 'positions';
type SettingsSection = 'organization' | 'leaves' | 'holidays' | 'documents' | 'attendance' | 'payroll' | 'all';

interface MasterDraft { name: string; code: string; description: string; departmentId: string; jobTitleId: string; }
interface LeaveTypeDraft { name: string; code: string; description: string; isPaid: 'paid' | 'unpaid'; deductsFromBalance?: boolean; }

const initialDraft: MasterDraft = { name: '', code: '', description: '', departmentId: '', jobTitleId: '' };
const initialLeaveTypeDraft: LeaveTypeDraft = { name: '', code: '', description: '', isPaid: 'paid' };

const SETTINGS_SECTIONS: { key: SettingsSection; label: string }[] = [
  { key: 'organization', label: 'الهيكل الوظيفي' },
  { key: 'leaves', label: 'الإجازات' },
  { key: 'holidays', label: 'العطلات الرسمية' },
  { key: 'documents', label: 'المستندات' },
  { key: 'attendance', label: 'الحضور' },
  { key: 'payroll', label: 'المرتبات' },
  { key: 'all', label: 'عرض الكل' },
];

function shouldShowSection(activeSection: SettingsSection, section: SettingsSection) { return activeSection === 'all' || activeSection === section; }

export function HrSettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const workspace = useHrWorkspace({ page: 1, pageSize: 200 });
  const leaveTypesQuery = useHrLeaveTypes({ page: 1, pageSize: 200 });
  const mutations = useHrMutations();

  const [settingsSearch, setSettingsSearch] = useState('');
  const [activeSection, setActiveSection] = useState<SettingsSection>('organization');
  const [departmentDraft, setDepartmentDraft] = useState<MasterDraft>(initialDraft);
  const [jobTitleDraft, setJobTitleDraft] = useState<MasterDraft>(initialDraft);
  const [positionDraft, setPositionDraft] = useState<MasterDraft>(initialDraft);
  const [leaveTypeDraft, setLeaveTypeDraft] = useState<LeaveTypeDraft>(initialLeaveTypeDraft);
  const [errors, setErrors] = useState<Record<MasterKind | 'leave-types', string>>({ departments: '', 'job-titles': '', positions: '', 'leave-types': '' });

  const departments = useMemo(() => workspace.departments.data?.rows || [], [workspace.departments.data?.rows]);
  const jobTitles = useMemo(() => workspace.jobTitles.data?.rows || [], [workspace.jobTitles.data?.rows]);
  const positions = useMemo(() => workspace.positions.data?.rows || [], [workspace.positions.data?.rows]);
  const leaveTypes = useMemo(() => leaveTypesQuery.data?.rows || [], [leaveTypesQuery.data?.rows]);
  const searchValue = settingsSearch.trim().toLowerCase();

  const filteredDepartments = useMemo(() => departments.filter((row) => !searchValue || String(row.name || '').toLowerCase().includes(searchValue) || String(row.code || '').toLowerCase().includes(searchValue) || String(row.description || '').toLowerCase().includes(searchValue)), [departments, searchValue]);
  const filteredJobTitles = useMemo(() => jobTitles.filter((row) => !searchValue || String(row.name || '').toLowerCase().includes(searchValue) || String(row.code || '').toLowerCase().includes(searchValue) || String(row.description || '').toLowerCase().includes(searchValue)), [jobTitles, searchValue]);
  const filteredPositions = useMemo(() => positions.filter((row) => !searchValue || String(row.name || '').toLowerCase().includes(searchValue) || String(row.code || '').toLowerCase().includes(searchValue) || String(row.departmentName || '').toLowerCase().includes(searchValue) || String(row.jobTitleName || '').toLowerCase().includes(searchValue) || String(row.description || '').toLowerCase().includes(searchValue)), [positions, searchValue]);
  const filteredLeaveTypes = useMemo(() => leaveTypes.filter((row) => !searchValue || String(row.name || '').toLowerCase().includes(searchValue) || String(row.code || '').toLowerCase().includes(searchValue) || String(row.description || '').toLowerCase().includes(searchValue)), [leaveTypes, searchValue]);

  async function saveKind(kind: MasterKind) {
    const draft = kind === 'departments' ? departmentDraft : kind === 'job-titles' ? jobTitleDraft : positionDraft;
    const name = String(draft.name || '').trim();
    if (!name) { setErrors((current) => ({ ...current, [kind]: 'الاسم مطلوب.' })); return; }
    setErrors((current) => ({ ...current, [kind]: '' }));
    const payload: Record<string, unknown> = { name, code: String(draft.code || '').trim() || undefined, description: String(draft.description || '').trim() || undefined };
    if (kind === 'positions') { payload.departmentId = toId(draft.departmentId); payload.jobTitleId = toId(draft.jobTitleId); }
    try {
      await mutations.saveMasterData.mutateAsync({ kind, payload });
      if (kind === 'departments') setDepartmentDraft(initialDraft);
      if (kind === 'job-titles') setJobTitleDraft(initialDraft);
      if (kind === 'positions') setPositionDraft(initialDraft);
    } catch (error) {
      setErrors((current) => ({ ...current, [kind]: getErrorMessage(error, 'تعذر حفظ البيانات.') }));
    }
  }

  async function saveLeaveType() {
    const name = String(leaveTypeDraft.name || '').trim();
    if (!name) { setErrors((current) => ({ ...current, 'leave-types': 'اسم نوع الإجازة مطلوب.' })); return; }
    setErrors((current) => ({ ...current, 'leave-types': '' }));
    try {
      await mutations.saveLeaveType.mutateAsync({ payload: { name, code: String(leaveTypeDraft.code || '').trim() || undefined, description: String(leaveTypeDraft.description || '').trim() || undefined, isPaid: leaveTypeDraft.isPaid === 'paid', deductsFromBalance: leaveTypeDraft.deductsFromBalance, isActive: true } });
      setLeaveTypeDraft(initialLeaveTypeDraft);
    } catch (error) {
      setErrors((current) => ({ ...current, 'leave-types': getErrorMessage(error, 'تعذر حفظ نوع الإجازة.') }));
    }
  }

  const isBusy = mutations.saveMasterData.isPending || mutations.saveLeaveType.isPending;
  const departmentStats = stats(departments);
  const jobTitleStats = stats(jobTitles);
  const positionStats = stats(positions);
  const leaveTypeStats = stats(leaveTypes);

  const healthSummary = useMemo(() => ({
    departments: departmentStats.total,
    jobTitles: jobTitleStats.total,
    leaveTypes: leaveTypeStats.total,
    documentTypes: 'غير متاح',
    inactiveTotal: departmentStats.inactive + jobTitleStats.inactive + positionStats.inactive + leaveTypeStats.inactive,
    reviewItems: positions.filter((row) => !normalize(row.departmentName) || !normalize(row.jobTitleName)).length,
  }), [departmentStats, jobTitleStats, positionStats, leaveTypeStats, positions]);

  return (
    <div className="page-stack page-shell" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '20px' }}>
        <PageHeader
          title={t('hr.hr_settings_page.s0', "إعدادات الموارد البشرية")}
          description={t('hr.hr_settings_page.s1', "إدارة الهيكل التنظيمي، أنواع الإجازات، العطلات، وسياسات الحضور والمرتبات.")}
          actions={
            <div className="actions compact-actions">
              <Button variant="secondary" onClick={() => navigate('/hr/employees/new')}>{t('hr.hr_settings_page.s2', "إضافة موظف")}</Button>
              <Button variant="secondary" onClick={() => navigate('/hr/employees')}>{t('hr.hr_settings_page.s3', "رجوع للموظفين")}</Button>
            </div>
          }
        />
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>

          {/* Compact Single-Row KPI Summary Bar */}
          <HrSettingsHealthSummaryCard healthSummary={healthSummary} />

          {/* Section Switcher Tabs & Search Toolbar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '16px', background: '#f8fafc', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {SETTINGS_SECTIONS.map((section) => (
                <Button
                  key={section.key}
                  type="button"
                  variant={activeSection === section.key ? 'primary' : 'secondary'}
                  onClick={() => setActiveSection(section.key)}
                  style={{ padding: '3px 10px', fontSize: '0.8rem' }}
                >
                  {section.label}
                </Button>
              ))}
            </div>
            <div style={{ minWidth: '180px' }}>
              <input
                value={settingsSearch}
                onChange={(event) => setSettingsSearch(event.target.value)}
                placeholder={t('hr.hr_settings_page.s4', "بحث داخل الإعدادات...")}
                style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
              />
            </div>
          </div>

          <QueryFeedback isLoading={workspace.departments.isLoading || workspace.jobTitles.isLoading || workspace.positions.isLoading || leaveTypesQuery.isLoading} isError={workspace.departments.isError || workspace.jobTitles.isError || workspace.positions.isError || leaveTypesQuery.isError} error={workspace.departments.error || workspace.jobTitles.error || workspace.positions.error || leaveTypesQuery.error} isEmpty={false} loadingText={t('hr.hr_settings_page.s5', "جاري تحميل إعدادات الموارد البشرية...")} errorTitle={t('hr.hr_settings_page.s6', "تعذر تحميل إعدادات الموارد البشرية")}>
            {shouldShowSection(activeSection, 'organization') ? <HrSettingsOrganizationSection departmentStatsTotal={departmentStats.total} jobTitleStatsTotal={jobTitleStats.total} positionStatsTotal={positionStats.total} departmentDraft={departmentDraft} jobTitleDraft={jobTitleDraft} positionDraft={positionDraft} errors={{ departments: errors.departments, 'job-titles': errors['job-titles'], positions: errors.positions }} isBusy={isBusy} departments={departments} jobTitles={jobTitles} filteredDepartments={filteredDepartments} filteredJobTitles={filteredJobTitles} filteredPositions={filteredPositions} onDepartmentDraftChange={setDepartmentDraft} onJobTitleDraftChange={setJobTitleDraft} onPositionDraftChange={setPositionDraft} onSaveDepartment={() => { void saveKind('departments'); }} onSaveJobTitle={() => { void saveKind('job-titles'); }} onSavePosition={() => { void saveKind('positions'); }} /> : null}

            {shouldShowSection(activeSection, 'leaves') ? (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.95rem', color: '#0f172a', marginBottom: '4px' }}>
                  <CalendarIcon size={18} style={{ color: 'var(--primary, #170c5c)' }} />
                  <span>{t('hr.hr_settings_page.s7', "أنواع الإجازات")}</span>
                </strong>
                <small style={{ display: 'block', color: '#64748b', marginBottom: '12px', fontSize: '0.8rem' }}>{t('hr.hr_settings_page.s8', "إدارة أنواع الإجازات المعتمدة وتأثيرها على الخصومات والمرتبات.")}</small>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '10px' }}>
                  <div><label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '2px' }}>{t('hr.hr_settings_page.s9', "الاسم *")}</label><input value={leaveTypeDraft.name} onChange={(e) => setLeaveTypeDraft((current) => ({ ...current, name: e.target.value }))} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} /></div>
                  <div><label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '2px' }}>{t('hr.hr_settings_page.s10', "الكود")}</label><input value={leaveTypeDraft.code} onChange={(e) => setLeaveTypeDraft((current) => ({ ...current, code: e.target.value }))} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} /></div>
                  <div><label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '2px' }}>{t('hr.hr_settings_page.s11', "النوع")}</label><select value={leaveTypeDraft.isPaid} onChange={(e) => setLeaveTypeDraft((current) => ({ ...current, isPaid: e.target.value as 'paid' | 'unpaid' }))} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}><option value="paid">{t('hr.hr_settings_page.s12', "مدفوعة")}</option><option value="unpaid">{t('hr.hr_settings_page.s13', "غير مدفوعة")}</option></select></div>
                  <div style={{ gridColumn: 'span 2' }}><label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '2px' }}>{t('hr.hr_settings_page.s14', "الوصف")}</label><input value={leaveTypeDraft.description} onChange={(e) => setLeaveTypeDraft((current) => ({ ...current, description: e.target.value }))} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} /></div>
                  <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: '6px' }}><input type="checkbox" checked={leaveTypeDraft.deductsFromBalance === true} onChange={(e) => setLeaveTypeDraft((current) => ({ ...current, deductsFromBalance: e.target.checked }))} style={{ width: '16px', height: '16px', flexShrink: 0 }} /><label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>{t('hr.hr_settings_page.s24', "تخصم من رصيد الإجازات")}</label><span style={{ fontSize: '0.75rem', color: '#64748b' }}>{t('hr.hr_settings_page.s25', "الإجازة السنوية تخصم دائمًا حتى لو لم تُعلَّم الخانة.")}</span></div>
                </div>
                {errors['leave-types'] ? <div style={{ color: '#dc2626', fontSize: '0.8rem', marginBottom: '8px' }}>{errors['leave-types']}</div> : null}
                <div className="compact-actions" style={{ marginBottom: '12px' }}>
                  <Button onClick={() => { void saveLeaveType(); }} disabled={isBusy} style={{ padding: '4px 12px', fontSize: '0.8rem' }}>{isBusy ? t('hr.hr_settings_page.s15', "جاري الحفظ...") : t('hr.hr_settings_page.s16', "حفظ نوع الإجازة")}</Button>
                  <Button type="button" variant="secondary" onClick={() => navigate('/hr/leaves')} style={{ padding: '4px 12px', fontSize: '0.8rem' }}>{t('hr.hr_settings_page.s17', "فتح صفحة الإجازات")}</Button>
                </div>
                {filteredLeaveTypes.length ? (
                  <DataTable
                    rows={filteredLeaveTypes}
                    rowKey={(row) => String(row.id)}
                    density="compact"
                    columns={[
                      { key: 'name', header: t('hr.hr_settings_page.s18', "الاسم"), cell: (row) => text(row.name) },
                      { key: 'code', header: t('hr.hr_settings_page.s19', "الكود"), cell: (row) => text(row.code) },
                      { key: 'paid', header: t('hr.hr_settings_page.s20', "مدفوعة / غير مدفوعة"), cell: (row) => paidLabel(row.isPaid) },
                      { key: 'deducts', header: t('hr.hr_settings_page.s26', "تخصم من الرصيد"), cell: (row) => (row.deductsFromBalance === true ? 'نعم' : 'لا') },
                      { key: 'status', header: t('hr.hr_settings_page.s21', "الحالة"), cell: (row) => statusLabel(row.isActive) },
                      { key: 'description', header: t('hr.hr_settings_page.s22', "الوصف"), cell: (row) => text(row.description) },
                    ]}
                  />
                ) : <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>{t('hr.hr_settings_page.s23', "لا توجد أنواع إجازات حتى الآن.")}</p>}
              </div>
            ) : null}

            {shouldShowSection(activeSection, 'holidays') ? <HrSettingsHolidaysSection /> : null}
            {shouldShowSection(activeSection, 'documents') ? <HrSettingsDocumentsSection navigate={navigate} /> : null}
            {shouldShowSection(activeSection, 'attendance') ? <HrSettingsAttendanceSection navigate={navigate} /> : null}
            {shouldShowSection(activeSection, 'payroll') ? <HrSettingsPayrollSection navigate={navigate} /> : null}
          </QueryFeedback>
        </div>
      </main>
    </div>
  );
}
