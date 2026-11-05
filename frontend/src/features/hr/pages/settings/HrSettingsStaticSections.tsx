import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { useHrPayrollPolicies, useHrMutations, useHrHolidays } from '@/features/hr/hooks/useHr';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { Button } from '@/shared/ui/button';
import { DataTable } from '@/shared/ui/data-table';
import { getErrorMessage } from '@/lib/errors';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import {
  FileTextIcon,
  ClockIcon,
  BanknotesIcon,
  CalendarDaysIcon,
} from '@/features/hr/components/HrIcons';
import { SlidersIcon, CheckShieldIcon, GlobeIcon } from '@/shared/components/icons/AppIcons';

type NavigateTo = (path: string) => void;

const COUNTRY_LABELS: Record<string, string> = {
  EG: 'مصر (EGP)',
  SA: 'المملكة العربية السعودية (SAR)',
  KW: 'الكويت (KWD)',
  QA: 'قطر (QAR)',
  OM: 'سلطنة عُمان (OMR)',
};

const STANDARD_DOCUMENT_TYPES = [
  { name: 'بطاقة الرقم القومي', validityDays: '7 سنوات', required: true, note: 'إلزامية لجميع الموظفين' },
  { name: 'شهادة المؤهل الدراسي', validityDays: 'دائمة', required: true, note: 'مطلوبة لإثبات التخصص' },
  { name: 'صحيفة الحالة الجنائية (فيش)', validityDays: '3 شهور', required: true, note: 'تُجدد عند التعيين' },
  { name: 'شهادة المعاملة العسكرية', validityDays: 'دائمة / مؤقتة', required: false, note: 'للذكور فقط' },
  { name: 'شهادة الميلاد المميكنة', validityDays: 'دائمة', required: true, note: 'مطلوبة للتأمينات' },
  { name: 'عقد العمل الموقع', validityDays: 'حسب مدة العقد', required: true, note: 'ساري بموجب مدة التعيين' },
  { name: 'كعب العمل والتأمينات', validityDays: 'عند التعيين', required: false, note: 'للتسجيل بالتأمينات' },
];

export function HrSettingsDocumentsSection({ navigate }: { navigate: NavigateTo }) {
  const { t } = useTranslation();
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
        <div>
          <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.95rem', color: '#0f172a' }}>
            <FileTextIcon size={18} style={{ color: 'var(--primary, #170c5c)' }} />
            <span>{t('hr.settings.hr_settings_static_sections.s0', "سياسات وأنواع مستندات الموظفين")}</span>
          </strong>
          <small style={{ color: '#64748b', fontSize: '0.775rem' }}>{t('hr.settings.hr_settings_static_sections.s1', "المستندات الثبوتية القياسية المعتمدة في ملف كل موظف وتنبيهات انتهاء الصلاحية.")}</small>
        </div>
        <Button type="button" variant="primary" onClick={() => navigate('/hr/documents')} style={{ padding: '4px 12px', fontSize: '0.8rem' }}>
          {t('hr.settings.hr_settings_static_sections.s2', "فتح صفحة المستندات")}
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px' }}>
          <span style={{ fontSize: '0.725rem', color: '#64748b', display: 'block' }}>{t('hr.settings.hr_settings_static_sections.s3', "المستندات الأساسية")}</span>
          <strong style={{ fontSize: '1rem', color: '#0f172a' }}>{t('hr.settings.hr_settings_static_sections.s4', "7 أنواع معتمدة")}</strong>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px' }}>
          <span style={{ fontSize: '0.725rem', color: '#64748b', display: 'block' }}>{t('hr.settings.hr_settings_static_sections.s5', "تنبيه قبل الانتهاء")}</span>
          <strong style={{ fontSize: '1rem', color: '#ea580c' }}>{t('hr.settings.hr_settings_static_sections.s6', "30 يوماً")}</strong>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px' }}>
          <span style={{ fontSize: '0.725rem', color: '#64748b', display: 'block' }}>{t('hr.settings.hr_settings_static_sections.s7', "حالة الربط")}</span>
          <strong style={{ fontSize: '1rem', color: '#166534' }}>{t('hr.settings.hr_settings_static_sections.s8', "مفعل بالملف الشخصي")}</strong>
        </div>
      </div>

      <div>
        <strong style={{ display: 'block', fontSize: '0.85rem', color: '#0f172a', marginBottom: '8px' }}>{t('hr.settings.hr_settings_static_sections.s9', "قائمة المستندات القياسية في النظام")}</strong>
        <DataTable
          rows={STANDARD_DOCUMENT_TYPES}
          rowKey={(row) => row.name}
          density="compact"
          columns={[
            { key: 'name', header: t('hr.settings.hr_settings_static_sections.s10', "نوع المستند"), cell: (row) => row.name },
            { key: 'validity', header: t('hr.settings.hr_settings_static_sections.s11', "الصلاحية القياسية"), cell: (row) => row.validityDays },
            { key: 'required', header: t('hr.settings.hr_settings_static_sections.s12', "الإلزامية"), cell: (row) => row.required ? <span style={{ color: '#166534', fontWeight: 600 }}>{t('hr.settings.hr_settings_static_sections.s13', "إلزامي")}</span> : <span style={{ color: '#64748b' }}>{t('hr.settings.hr_settings_static_sections.s14', "اختياري")}</span> },
            { key: 'note', header: t('hr.settings.hr_settings_static_sections.s15', "ملاحظات"), cell: (row) => row.note },
          ]}
        />
      </div>
    </div>
  );
}

export function HrSettingsAttendanceSection({ navigate }: { navigate: NavigateTo }) {
  const { t } = useTranslation();
  const policiesQuery = useHrPayrollPolicies();
  const mutations = useHrMutations();

  const [attendanceDraft, setAttendanceDraft] = useState({
    workHoursPerDay: '8',
    latenessGracePeriodMinutes: '15',
    overtimeMultiplier: '1',
  });
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (policiesQuery.data) {
      const data = policiesQuery.data as any;
      setAttendanceDraft({
        workHoursPerDay: String(data.workHoursPerDay ?? '8'),
        latenessGracePeriodMinutes: String(data.latenessGracePeriodMinutes ?? '15'),
        overtimeMultiplier: String(data.overtimeMultiplier ?? '1'),
      });
    }
  }, [policiesQuery.data]);

  async function handleSaveAttendancePolicies() {
    setSaveError('');
    const rawHours = Number(attendanceDraft.workHoursPerDay);
    const rawGrace = Number(attendanceDraft.latenessGracePeriodMinutes);
    const rawMult = Number(attendanceDraft.overtimeMultiplier);

    if (!Number.isFinite(rawHours) || rawHours <= 0 || rawHours > 24) {
      setSaveError('ساعات العمل اليومية يجب أن تكون قيمة صحيحة بين 1 و24 ساعة.');
      return;
    }
    if (!Number.isFinite(rawGrace) || rawGrace < 0) {
      setSaveError('فترة السماح يجب أن تكون صفر أو أكثر بالدقائق.');
      return;
    }
    if (!Number.isFinite(rawMult) || rawMult < 1 || rawMult > 5) {
      setSaveError('مضاعف الوقت الإضافي يجب أن يكون بين 1.0 و 5.0.');
      return;
    }

    try {
      const existing = (policiesQuery.data || {}) as Record<string, any>;
      await mutations.updatePayrollPolicies.mutateAsync({
        ...existing,
        workHoursPerDay: rawHours,
        latenessGracePeriodMinutes: rawGrace,
        overtimeMultiplier: rawMult,
      });
      toast.success('تم حفظ وتحديث ضوابط الحضور والانصراف بنجاح');
    } catch (err) {
      const msg = getErrorMessage(err, 'تعذر حفظ ضوابط الحضور والانصراف');
      setSaveError(msg);
      toast.error(msg);
    }
  }

  const isSaving = mutations.updatePayrollPolicies.isPending;
  const currentMultiplier = Number(attendanceDraft.overtimeMultiplier) || 1;

  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
        <div>
          <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.95rem', color: '#0f172a' }}>
            <ClockIcon size={18} style={{ color: 'var(--primary, #170c5c)' }} />
            <span>{t('hr.settings.hr_settings_static_sections.s16', "سياسات وضوابط الحضور والانصراف")}</span>
          </strong>
          <small style={{ color: '#64748b', fontSize: '0.775rem' }}>{t('hr.settings.hr_settings_static_sections.s17', "إدارة ساعات الورديات، فترات السماح، احتساب الإضافي، وقواعد ضبط ساعات الأجر.")}</small>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button type="button" variant="primary" onClick={() => navigate('/hr/attendance')} style={{ padding: '4px 12px', fontSize: '0.8rem' }}>
            {t('hr.settings.hr_settings_static_sections.s18', "فتح سجل الحضور")}
          </Button>
        </div>
      </div>

      {/* Dynamic 4 Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px' }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px' }}>
          <span style={{ fontSize: '0.725rem', color: '#64748b', display: 'block' }}>ساعات العمل اليومية</span>
          <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{attendanceDraft.workHoursPerDay} ساعات / يوم</strong>
          <small style={{ fontSize: '0.675rem', color: '#94a3b8', display: 'block' }}>سقف ساعات الأجر العادية</small>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px' }}>
          <span style={{ fontSize: '0.725rem', color: '#64748b', display: 'block' }}>فترة السماح للتأخير</span>
          <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{attendanceDraft.latenessGracePeriodMinutes} دقيقة</strong>
          <small style={{ fontSize: '0.675rem', color: '#94a3b8', display: 'block' }}>قبل بدء احتساب الخصومات</small>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px' }}>
          <span style={{ fontSize: '0.725rem', color: '#64748b', display: 'block' }}>احتساب الإضافي</span>
          <strong style={{ fontSize: '0.95rem', color: currentMultiplier === 1 ? '#2563eb' : '#166534' }}>
            مضاعف {attendanceDraft.overtimeMultiplier}x
          </strong>
          <small style={{ fontSize: '0.675rem', color: currentMultiplier === 1 ? '#3b82f6' : '#15803d', display: 'block', fontWeight: 600 }}>
            {currentMultiplier === 1 ? 'أجر عادي (ساعة بساعة)' : `ساعة × ${currentMultiplier}`}
          </small>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px' }}>
          <span style={{ fontSize: '0.725rem', color: '#64748b', display: 'block' }}>اعتماد ساعات الإضافي</span>
          <strong style={{ fontSize: '0.95rem', color: '#166534' }}>اعتماد إداري إلزامي</strong>
          <small style={{ fontSize: '0.675rem', color: '#15803d', display: 'block', fontWeight: 600 }}>محمي: لا تُصرف تلقائياً</small>
        </div>
      </div>

      {/* In-place Attendance Policies Editor Card */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
          <SlidersIcon size={16} style={{ color: 'var(--primary, #170c5c)' }} />
          <strong style={{ fontSize: '0.875rem', color: '#0f172a' }}>ضبط وتعديل سياسات الحضور وساعات الأجر</strong>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '12px' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span>ساعات العمل المقررة يومياً (ساعات)</span>
            <input
              type="number"
              step="0.5"
              min="1"
              max="24"
              value={attendanceDraft.workHoursPerDay}
              onChange={(e) => setAttendanceDraft({ ...attendanceDraft, workHoursPerDay: e.target.value })}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', background: '#fff' }}
            />
            <small style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 400 }}>عدد الساعات المتفق عليها في الوردية والتي يُقفل عندها ساعات الأجر اليومية.</small>
          </label>

          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span>فترة السماح للتأخير (بالدقائق)</span>
            <input
              type="number"
              min="0"
              max="180"
              value={attendanceDraft.latenessGracePeriodMinutes}
              onChange={(e) => setAttendanceDraft({ ...attendanceDraft, latenessGracePeriodMinutes: e.target.value })}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', background: '#fff' }}
            />
            <small style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 400 }}>الحد الأقصى للتأخير المسموح به قبل بدء احتساب خصومات الحضور.</small>
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>مضاعف احتساب الوقت الإضافي (Overtime Multiplier)</span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                type="number"
                step="0.1"
                min="1"
                max="5"
                value={attendanceDraft.overtimeMultiplier}
                onChange={(e) => setAttendanceDraft({ ...attendanceDraft, overtimeMultiplier: e.target.value })}
                style={{ width: '90px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', background: '#fff' }}
              />
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => setAttendanceDraft({ ...attendanceDraft, overtimeMultiplier: '1' })}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '5px',
                    border: '1px solid #cbd5e1',
                    background: attendanceDraft.overtimeMultiplier === '1' ? '#170c5c' : '#f8fafc',
                    color: attendanceDraft.overtimeMultiplier === '1' ? '#ffffff' : '#334155',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  1.0x (عادي)
                </button>
                <button
                  type="button"
                  onClick={() => setAttendanceDraft({ ...attendanceDraft, overtimeMultiplier: '1.5' })}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '5px',
                    border: '1px solid #cbd5e1',
                    background: attendanceDraft.overtimeMultiplier === '1.5' ? '#170c5c' : '#f8fafc',
                    color: attendanceDraft.overtimeMultiplier === '1.5' ? '#ffffff' : '#334155',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  1.5x (ساعة ونصف)
                </button>
                <button
                  type="button"
                  onClick={() => setAttendanceDraft({ ...attendanceDraft, overtimeMultiplier: '2' })}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '5px',
                    border: '1px solid #cbd5e1',
                    background: attendanceDraft.overtimeMultiplier === '2' ? '#170c5c' : '#f8fafc',
                    color: attendanceDraft.overtimeMultiplier === '2' ? '#ffffff' : '#334155',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  2.0x (ضعف)
                </button>
              </div>
            </div>
            <small style={{ fontSize: '0.7rem', color: '#64748b' }}>
              القيمة 1 تعني احتساب ساعة الإضافي المعتمدة كساعة عادية (1x)، و 1.5 تعني ساعة ونصف.
            </small>
          </div>
        </div>

        {saveError && (
          <div style={{ color: '#dc2626', fontSize: '0.8rem', marginBottom: '8px', fontWeight: 600 }}>
            {saveError}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button
            type="button"
            variant="primary"
            onClick={() => void handleSaveAttendancePolicies()}
            disabled={isSaving}
            style={{ padding: '5px 16px', fontSize: '0.825rem', background: '#170c5c' }}
          >
            {isSaving ? 'جاري الحفظ...' : 'حفظ ضوابط الحضور'}
          </Button>
        </div>
      </div>

      {/* Rules Explanatory Box */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px' }}>
        <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: '#0f172a', marginBottom: '6px' }}>
          <CheckShieldIcon size={16} style={{ color: '#166534' }} />
          <span>{t('hr.settings.hr_settings_static_sections.s27', "قواعد الربط مع مسير المرتبات وساعات الأجر")}</span>
        </strong>
        <ul style={{ margin: 0, paddingRight: '20px', fontSize: '0.8rem', color: '#475569', lineHeight: 1.6 }}>
          <li>
            <strong>ساعات الأجر مسقوفة:</strong> ساعات الأجر اليومية لأي موظف مسقوفة بساعات العمل اليومية المقررة ({attendanceDraft.workHoursPerDay} ساعات)، حتى لو قضى الموظف ساعات أطول في مقر العمل.
          </li>
          <li>
            <strong>حماية الساعات الإضافية:</strong> الساعات الزائدة عن الوردية تظهر تلقائياً كـ "إضافي بانتظار الاعتماد" ولا تُصرف ولا تدخل في ساعات الأجر إلا بعد اعتمادها من المدير في مراجعة الحضور.
          </li>
          <li>
            <strong>احتساب قيمة الإضافي:</strong> عند اعتماد الساعات الإضافية، تُصرف وفقاً للمضاعف المحدد (مضاعف {attendanceDraft.overtimeMultiplier}x).
          </li>
          <li>
            <strong>الغياب والتأخير:</strong> ساعات الغياب والتأخير غير المبررة تُرّحل تلقائياً كخصومات عند إنشاء مسير المرتبات الشهري.
          </li>
        </ul>
      </div>
    </div>
  );
}

export function HrSettingsPayrollSection({ navigate }: { navigate: NavigateTo }) {
  const { t } = useTranslation();
  const policiesQuery = useHrPayrollPolicies();
  const mutations = useHrMutations();
  const [draft, setDraft] = useState({
    workHoursPerDay: '8',
    latenessGracePeriodMinutes: '15',
    latenessPenaltyMultiplier: '0.25',
    absencePenaltyMultiplier: '1',
    overtimeMultiplier: '1.5',
    hrDelayPolicyEnabled: false,
    hrDelayPolicyFirstTimeDeduction: '0.25',
    hrDelayPolicySecondTimeDeduction: '0.5',
    hrDelayPolicyThirdTimeDeduction: '1',
    hrDelayPolicyFourthTimeDeduction: '1',
    hrCommissionType: 'none',
    hrCommissionValue: '0',
    hrCommissionTarget: '0',
    hrSocialInsuranceEnabled: false,
    hrSocialInsuranceEmployeePct: '0',
    hrIncomeTaxEnabled: false,
    taxPersonalExemption: '0',
    taxBrackets: [] as Array<{ max: number | null; rate: number }>,
    insuranceConfig: { employeePct: 0, employerPct: 0, minSalary: 0, maxSalary: 0 },
    hrWeekendDays: 'friday,saturday',
    directAdvanceCashCap: '',
  });
  const [statutoryDraft, setStatutoryDraft] = useState({
    statutoryCountry: '',
    statutoryEffectiveFrom: '2020-01-01',
    statutoryEffectiveTo: '',
    statutoryLegalReference: 'اللائحة الداخلية للمنشأة',
    statutoryReviewed: true,
    insuranceWageBasis: 'earned_base',
    insuranceProratePartialEmployment: false,
    taxableEarningsBasis: 'gross_after_attendance_leave',
    taxDeductEmployeeInsurance: false,
  });
  const [taxBracketsText, setTaxBracketsText] = useState('[]');
  const [statutoryInputError, setStatutoryInputError] = useState('');

  useEffect(() => {
    if (policiesQuery.data) {
      const source = policiesQuery.data as any;
      setStatutoryDraft({
        statutoryCountry: String(source.statutoryCountry || ''),
        statutoryEffectiveFrom: String(source.statutoryEffectiveFrom || '2020-01-01'),
        statutoryEffectiveTo: String(source.statutoryEffectiveTo || ''),
        statutoryLegalReference: String(source.statutoryLegalReference || 'اللائحة الداخلية للمنشأة'),
        statutoryReviewed: true,
        insuranceWageBasis: String(source.insuranceWageBasis || 'earned_base'),
        insuranceProratePartialEmployment: source.insuranceProratePartialEmployment === true,
        taxableEarningsBasis: String(source.taxableEarningsBasis || 'gross_after_attendance_leave'),
        taxDeductEmployeeInsurance: source.taxDeductEmployeeInsurance === true,
      });
      setTaxBracketsText(JSON.stringify(source.taxBrackets || []));
      setDraft({
        workHoursPerDay: String((policiesQuery.data as any).workHoursPerDay ?? '8'),
        latenessGracePeriodMinutes: String((policiesQuery.data as any).latenessGracePeriodMinutes ?? '15'),
        latenessPenaltyMultiplier: String((policiesQuery.data as any).latenessPenaltyMultiplier ?? '0.25'),
        absencePenaltyMultiplier: String((policiesQuery.data as any).absencePenaltyMultiplier ?? '1'),
        overtimeMultiplier: String((policiesQuery.data as any).overtimeMultiplier ?? '1.5'),
        hrDelayPolicyEnabled: (policiesQuery.data as any).hrDelayPolicyEnabled === true,
        hrDelayPolicyFirstTimeDeduction: String((policiesQuery.data as any).hrDelayPolicyFirstTimeDeduction ?? '0.25'),
        hrDelayPolicySecondTimeDeduction: String((policiesQuery.data as any).hrDelayPolicySecondTimeDeduction ?? '0.5'),
        hrDelayPolicyThirdTimeDeduction: String((policiesQuery.data as any).hrDelayPolicyThirdTimeDeduction ?? '1'),
        hrDelayPolicyFourthTimeDeduction: String((policiesQuery.data as any).hrDelayPolicyFourthTimeDeduction ?? '1'),
        hrCommissionType: String((policiesQuery.data as any).hrCommissionType || 'none'),
        hrCommissionValue: String((policiesQuery.data as any).hrCommissionValue || '0'),
        hrCommissionTarget: String((policiesQuery.data as any).hrCommissionTarget || '0'),
        hrSocialInsuranceEnabled: (policiesQuery.data as any).hrSocialInsuranceEnabled === true,
        hrSocialInsuranceEmployeePct: String((policiesQuery.data as any).hrSocialInsuranceEmployeePct ?? '0'),
        hrIncomeTaxEnabled: (policiesQuery.data as any).hrIncomeTaxEnabled === true,
        taxPersonalExemption: String((policiesQuery.data as any).taxPersonalExemption ?? '0'),
        taxBrackets: (policiesQuery.data as any).taxBrackets || [],
        insuranceConfig: (policiesQuery.data as any).insuranceConfig || { employeePct: 0, employerPct: 0, minSalary: 0, maxSalary: 0 },
        hrWeekendDays: String((policiesQuery.data as any).hrWeekendDays || 'friday,saturday'),
        directAdvanceCashCap: String((policiesQuery.data as any).directAdvanceCashCap ?? ''),
      });
    }
  }, [policiesQuery.data]);

  async function handleSave() {
    setStatutoryInputError('');
    const rawCap = String(draft.directAdvanceCashCap || '').trim();
    const capValue = rawCap === '' ? null : Number(rawCap);
    if (capValue !== null && (!Number.isFinite(capValue) || capValue <= 0)) {
      setStatutoryInputError('سقف السلفة المباشرة يجب أن يكون رقمًا موجبًا، أو اتركه فارغًا للسقف الافتراضي (2,000).');
      return;
    }
    let taxBrackets: Array<{ max: number | null; rate: number }> = [];
    try {
      const parsed = JSON.parse(taxBracketsText);
      if (!Array.isArray(parsed)) throw new Error('invalid brackets');
      taxBrackets = parsed;
    } catch {
      setStatutoryInputError('صيغة شرائح الضريبة غير صحيحة. أدخل مصفوفة JSON تحتوي على max و rate.');
      return;
    }
    try {
      await mutations.updatePayrollPolicies.mutateAsync({
        workHoursPerDay: Number(draft.workHoursPerDay) || 8,
        latenessGracePeriodMinutes: Number(draft.latenessGracePeriodMinutes) || 0,
        latenessPenaltyMultiplier: Number(draft.latenessPenaltyMultiplier) || 0,
        absencePenaltyMultiplier: Number(draft.absencePenaltyMultiplier) || 0,
        overtimeMultiplier: Number(draft.overtimeMultiplier) || 1,
        hrDelayPolicyEnabled: draft.hrDelayPolicyEnabled,
        hrDelayPolicyFirstTimeDeduction: Number(draft.hrDelayPolicyFirstTimeDeduction) || 0,
        hrDelayPolicySecondTimeDeduction: Number(draft.hrDelayPolicySecondTimeDeduction) || 0,
        hrDelayPolicyThirdTimeDeduction: Number(draft.hrDelayPolicyThirdTimeDeduction) || 0,
        hrDelayPolicyFourthTimeDeduction: Number(draft.hrDelayPolicyFourthTimeDeduction) || 0,
        hrCommissionType: draft.hrCommissionType,
        hrCommissionValue: Number(draft.hrCommissionValue) || 0,
        hrCommissionTarget: Number(draft.hrCommissionTarget) || 0,
        hrSocialInsuranceEnabled: draft.hrSocialInsuranceEnabled,
        hrSocialInsuranceEmployeePct: Number(draft.hrSocialInsuranceEmployeePct) || 0,
        hrIncomeTaxEnabled: draft.hrIncomeTaxEnabled,
        taxPersonalExemption: Number(draft.taxPersonalExemption) || 0,
        taxBrackets,
        insuranceConfig: draft.insuranceConfig,
        ...statutoryDraft,
        statutoryCountry: statutoryDraft.statutoryCountry || 'EG',
        statutoryEffectiveFrom: statutoryDraft.statutoryEffectiveFrom || '2020-01-01',
        statutoryLegalReference: statutoryDraft.statutoryLegalReference || 'اللائحة الداخلية للمنشأة',
        statutoryReviewed: true,
        hrWeekendDays: draft.hrWeekendDays,
        // N2: the scalar cap is this tenant's control; an empty field omits
        // the key so the per-currency map (or the 2,000 default) applies.
        // The map itself is preserved verbatim: this form rebuilds its
        // payload and must not wipe entries configured per currency.
        ...(capValue !== null ? { directAdvanceCashCap: capValue } : {}),
        directAdvanceCashCapByCurrency: (policiesQuery.data as any)?.directAdvanceCashCapByCurrency,
      });
      toast.success('تم حفظ واعتماد سياسات وقواعد المرتبات بنجاح');
    } catch (error) {
      const msg = getErrorMessage(error, 'تعذر اعتماد قواعد المرتبات');
      setStatutoryInputError(msg);
      toast.error(msg);
    }
  }

  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
        <div>
          <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.95rem', color: '#0f172a' }}>
            <BanknotesIcon size={18} style={{ color: 'var(--primary, #170c5c)' }} />
            <span>{t('hr.settings.hr_settings_static_sections.s31', "قواعد وسياسات المرتبات والخصومات")}</span>
          </strong>
          <small style={{ color: '#64748b', fontSize: '0.775rem' }}>{t('hr.settings.hr_settings_static_sections.s32', "إعدادات القواعد الحسابية وساعات العمل، التأخير، الضرائب والتأمينات.")}</small>
        </div>
      </div>

      <QueryFeedback isLoading={policiesQuery.isLoading} isError={policiesQuery.isError} error={policiesQuery.error} isEmpty={false}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          {/* Card 1: Work Hours & Multipliers */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px' }}>
            <strong style={{ display: 'block', fontSize: '0.85rem', color: '#0f172a', marginBottom: '8px' }}>{t('hr.settings.hr_settings_static_sections.s33', "ساعات العمل ومُعاملات الخصم والإضافي")}</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span>{t('hr.settings.hr_settings_static_sections.s34', "ساعات العمل اليومية")}</span>
                <input type="number" step="0.5" value={draft.workHoursPerDay} onChange={(e) => setDraft({ ...draft, workHoursPerDay: e.target.value })} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} />
              </label>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span>{t('hr.settings.hr_settings_static_sections.s35', "فترة السماح للتأخير (دقائق)")}</span>
                <input type="number" value={draft.latenessGracePeriodMinutes} onChange={(e) => setDraft({ ...draft, latenessGracePeriodMinutes: e.target.value })} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} />
              </label>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span>{t('hr.settings.hr_settings_static_sections.s36', "مُعامل خصم التأخير")}</span>
                <input type="number" step="0.1" value={draft.latenessPenaltyMultiplier} onChange={(e) => setDraft({ ...draft, latenessPenaltyMultiplier: e.target.value })} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} />
              </label>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span>{t('hr.settings.hr_settings_static_sections.s37', "مُعامل خصم الغياب")}</span>
                <input type="number" step="0.1" value={draft.absencePenaltyMultiplier} onChange={(e) => setDraft({ ...draft, absencePenaltyMultiplier: e.target.value })} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} />
              </label>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span>{t('hr.settings.hr_settings_static_sections.s38', "مضاعف الوقت الإضافي")}</span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input type="number" step="0.1" min="1" max="5" value={draft.overtimeMultiplier} onChange={(e) => setDraft({ ...draft, overtimeMultiplier: e.target.value })} style={{ width: '80px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} />
                  <div style={{ display: 'flex', gap: '3px' }}>
                    <button type="button" onClick={() => setDraft({ ...draft, overtimeMultiplier: '1' })} style={{ padding: '2px 6px', fontSize: '0.7rem', fontWeight: 600, borderRadius: '4px', border: '1px solid #cbd5e1', background: draft.overtimeMultiplier === '1' ? '#170c5c' : '#f8fafc', color: draft.overtimeMultiplier === '1' ? '#fff' : '#334155', cursor: 'pointer' }}>1.0x</button>
                    <button type="button" onClick={() => setDraft({ ...draft, overtimeMultiplier: '1.5' })} style={{ padding: '2px 6px', fontSize: '0.7rem', fontWeight: 600, borderRadius: '4px', border: '1px solid #cbd5e1', background: draft.overtimeMultiplier === '1.5' ? '#170c5c' : '#f8fafc', color: draft.overtimeMultiplier === '1.5' ? '#fff' : '#334155', cursor: 'pointer' }}>1.5x</button>
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Card 2: Progressive Delay Policy */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
              <strong style={{ fontSize: '0.85rem', color: '#0f172a' }}>{t('hr.settings.hr_settings_static_sections.s39', "سياسة التأخير التصاعدية")}</strong>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.825rem', fontWeight: 600, color: '#334155', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={draft.hrDelayPolicyEnabled}
                  onChange={(e) => setDraft({ ...draft, hrDelayPolicyEnabled: e.target.checked })}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', margin: 0, accentColor: 'var(--primary, #170c5c)' }}
                />
                <span>{t('hr.settings.hr_settings_static_sections.s40', "تفعيل سياسة التأخير التصاعدية")}</span>
              </label>
            </div>
            <p className="muted" style={{ margin: '0 0 8px 0', fontSize: '0.75rem' }}>{t('hr.settings.hr_settings_static_sections.s41', "تطبيق خصم تصاعدي لمرات التأخير المتكررة في نفس الشهر بدلاً من الخصم المباشر للدقائق.")}</p>
            {draft.hrDelayPolicyEnabled && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px', marginTop: '6px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span>{t('hr.settings.hr_settings_static_sections.s42', "خصم التأخير الأول (يوم)")}</span>
                  <input type="number" step="0.1" value={draft.hrDelayPolicyFirstTimeDeduction} onChange={(e) => setDraft({ ...draft, hrDelayPolicyFirstTimeDeduction: e.target.value })} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} />
                </label>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span>{t('hr.settings.hr_settings_static_sections.s43', "خصم التأخير الثاني")}</span>
                  <input type="number" step="0.1" value={draft.hrDelayPolicySecondTimeDeduction} onChange={(e) => setDraft({ ...draft, hrDelayPolicySecondTimeDeduction: e.target.value })} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} />
                </label>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span>{t('hr.settings.hr_settings_static_sections.s44', "خصم التأخير الثالث")}</span>
                  <input type="number" step="0.1" value={draft.hrDelayPolicyThirdTimeDeduction} onChange={(e) => setDraft({ ...draft, hrDelayPolicyThirdTimeDeduction: e.target.value })} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} />
                </label>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span>{t('hr.settings.hr_settings_static_sections.s45', "خصم التأخير الرابع فأكثر")}</span>
                  <input type="number" step="0.1" value={draft.hrDelayPolicyFourthTimeDeduction} onChange={(e) => setDraft({ ...draft, hrDelayPolicyFourthTimeDeduction: e.target.value })} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} />
                </label>
              </div>
            )}
          </div>

          {/* Card 3: Tax, Insurance & Weekend Days */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
              <strong style={{ fontSize: '0.85rem', color: '#0f172a' }}>{t('hr.settings.hr_settings_static_sections.s46', "الضرائب، التأمينات، والراحة الأسبوعية")}</strong>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 8px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', color: '#334155' }}>
                <GlobeIcon size={14} style={{ color: 'var(--primary, #170c5c)' }} />
                <span>دولة المرتبات: <strong>{COUNTRY_LABELS[statutoryDraft.statutoryCountry] || statutoryDraft.statutoryCountry || 'مصر (EGP)'}</strong> (تلقائياً من إعدادات النظام)</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.825rem', fontWeight: 600, color: '#334155', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={draft.hrSocialInsuranceEnabled}
                  onChange={(e) => setDraft({ ...draft, hrSocialInsuranceEnabled: e.target.checked })}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', margin: 0, accentColor: 'var(--primary, #170c5c)' }}
                />
                <span>{t('hr.settings.hr_settings_static_sections.s47', "استقطاع التأمينات الاجتماعية")}</span>
              </label>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.825rem', fontWeight: 600, color: '#334155', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={draft.hrIncomeTaxEnabled}
                  onChange={(e) => setDraft({ ...draft, hrIncomeTaxEnabled: e.target.checked })}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', margin: 0, accentColor: 'var(--primary, #170c5c)' }}
                />
                <span>{t('hr.settings.hr_settings_static_sections.s49', "تفعيل ضريبة كسب العمل")}</span>
              </label>

              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: 'auto' }}>
                <span>{t('hr.settings.hr_settings_static_sections.s50', "أيام الراحة الأسبوعية:")}</span>
                <input type="text" value={draft.hrWeekendDays} onChange={(e) => setDraft({ ...draft, hrWeekendDays: e.target.value })} placeholder="friday,saturday" dir="ltr" style={{ width: '150px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', background: '#fff' }} />
              </label>
            </div>

            {/* Social Insurance Detailed Config */}
            {draft.hrSocialInsuranceEnabled && (
              <div style={{ marginTop: '12px', padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                <strong style={{ gridColumn: '1 / -1', fontSize: '0.8rem', color: '#1e293b' }}>قواعد احتساب التأمينات الاجتماعية</strong>
                <label style={{ fontSize: '0.75rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span>أساس الأجر التأميني</span>
                  <select value={statutoryDraft.insuranceWageBasis || 'earned_base'} onChange={e => setStatutoryDraft({ ...statutoryDraft, insuranceWageBasis: e.target.value })} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.825rem' }}>
                    <option value="earned_base">إجمالي الأجر المكتسب بعد خصومات الحضور والإجازات</option>
                    <option value="employee_insurance_salary">الأجر التأميني المحدد بملف الموظف</option>
                  </select>
                </label>
                <label style={{ fontSize: '0.75rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span>حصة الموظف (%)</span>
                  <input type="number" min="0" max="100" step=".01" value={draft.insuranceConfig.employeePct} onChange={e => setDraft({ ...draft, insuranceConfig: { ...draft.insuranceConfig, employeePct: Number(e.target.value) } })} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.825rem' }}/>
                </label>
                <label style={{ fontSize: '0.75rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span>حصة الشركة (%)</span>
                  <input type="number" min="0" max="100" step=".01" value={draft.insuranceConfig.employerPct} onChange={e => setDraft({ ...draft, insuranceConfig: { ...draft.insuranceConfig, employerPct: Number(e.target.value) } })} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.825rem' }}/>
                </label>
                <label style={{ fontSize: '0.75rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span>أدنى أجر تأميني</span>
                  <input type="number" min="0" value={draft.insuranceConfig.minSalary} onChange={e => setDraft({ ...draft, insuranceConfig: { ...draft.insuranceConfig, minSalary: Number(e.target.value) } })} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.825rem' }}/>
                </label>
                <label style={{ fontSize: '0.75rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span>أعلى أجر تأميني (0 = بلا سقف)</span>
                  <input type="number" min="0" value={draft.insuranceConfig.maxSalary} onChange={e => setDraft({ ...draft, insuranceConfig: { ...draft.insuranceConfig, maxSalary: Number(e.target.value) } })} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.825rem' }}/>
                </label>
                <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: '#475569', cursor: 'pointer' }}>
                  <input type="checkbox" checked={statutoryDraft.insuranceProratePartialEmployment} onChange={e => setStatutoryDraft({ ...statutoryDraft, insuranceProratePartialEmployment: e.target.checked })} style={{ width: '15px', height: '15px' }}/>
                  <span>احتساب الأجر التأميني بنسبة أيام الخدمة عند التعيين أو انتهاء الخدمة وسط الشهر</span>
                </label>
              </div>
            )}

            {/* Income Tax Detailed Config */}
            {draft.hrIncomeTaxEnabled && (
              <div style={{ marginTop: '12px', padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                <strong style={{ gridColumn: '1 / -1', fontSize: '0.8rem', color: '#1e293b' }}>قواعد احتساب ضريبة كسب العمل</strong>
                <label style={{ fontSize: '0.75rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span>وعاء الدخل الخاضع للضريبة</span>
                  <select value={statutoryDraft.taxableEarningsBasis || 'gross_after_attendance_leave'} onChange={e => setStatutoryDraft({ ...statutoryDraft, taxableEarningsBasis: e.target.value })} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.825rem' }}>
                    <option value="gross_after_attendance_leave">المستحقات بعد خصومات الحضور والإجازات غير المدفوعة</option>
                    <option value="gross">إجمالي المستحقات قبل خصومات الحضور</option>
                  </select>
                </label>
                <label style={{ fontSize: '0.75rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span>الإعفاء السنوي الشخصي</span>
                  <input type="number" min="0" value={draft.taxPersonalExemption} onChange={e => setDraft({ ...draft, taxPersonalExemption: e.target.value })} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.825rem' }}/>
                </label>
                <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: '#475569', cursor: 'pointer' }}>
                  <input type="checkbox" checked={statutoryDraft.taxDeductEmployeeInsurance} onChange={e => setStatutoryDraft({ ...statutoryDraft, taxDeductEmployeeInsurance: e.target.checked })} style={{ width: '15px', height: '15px' }}/>
                  <span>خصم حصة تأمينات الموظف قبل حساب وعاء الضريبة</span>
                </label>
                <label style={{ gridColumn: '1 / -1', fontSize: '0.75rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span>شرائح الضريبة السنوية (مصفوفة JSON تنتهي بـ max: null)</span>
                  <textarea rows={2} value={taxBracketsText} onChange={e => setTaxBracketsText(e.target.value)} style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontFamily: 'monospace' }} dir="ltr"/>
                </label>
              </div>
            )}
          </div>

          {/* Card 4: Direct cashier advance cap (N2, per-currency setting) */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px' }}>
            <strong style={{ display: 'block', fontSize: '0.85rem', color: '#0f172a', marginBottom: '8px' }}>سقف السلفة المباشرة للكاشير</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span>السقف (بعملة المنشأة) — فارغ = الافتراضي 2,000</span>
                <input type="number" min="0" step="any" value={draft.directAdvanceCashCap} onChange={(e) => setDraft({ ...draft, directAdvanceCashCap: e.target.value })} placeholder="2000" style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} />
              </label>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '8px 0 0' }}>الحد الأقصى الذي يصرفه الكاشير مباشرة دون اعتماد المدير (بجانب قاعدة 50% من الرصيد). يمكن ضبط سقف مختلف لكل عملة عبر واجهة السياسات؛ ويُحفظ أي سقف مضبوط لكل عملة عند الحفظ من هنا.</p>
          </div>

          {statutoryInputError && <p role="alert" style={{ color: '#b91c1c', fontSize: 12, margin: 0 }}>{statutoryInputError}</p>}
          <div className="compact-actions" style={{ display: 'flex', gap: 8, marginTop: '4px' }}>
            <Button type="button" variant="primary" onClick={() => void handleSave()} disabled={mutations.updatePayrollPolicies.isPending} style={{ padding: '4px 14px', fontSize: '0.8rem' }}>
              {mutations.updatePayrollPolicies.isPending ? t('hr.settings.hr_settings_static_sections.s51', "جاري الحفظ...") : t('hr.settings.hr_settings_static_sections.s52', "حفظ سياسات المرتبات")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/hr/payroll')} style={{ padding: '4px 12px', fontSize: '0.8rem' }}>{t('hr.settings.hr_settings_static_sections.s53', "فتح مسير المرتبات")}</Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/hr/loans')} style={{ padding: '4px 12px', fontSize: '0.8rem' }}>{t('hr.settings.hr_settings_static_sections.s54', "فتح السلف")}</Button>
          </div>
        </div>
      </QueryFeedback>
    </div>
  );
}

export function HrSettingsHolidaysSection() {
  const { t } = useTranslation();
  const holidaysQuery = useHrHolidays({ page: 1, pageSize: 200 });
  const mutations = useHrMutations();
  const [draft, setDraft] = useState({ name: '', startDate: '', endDate: '' });
  const [error, setError] = useState('');

  const holidays = (holidaysQuery.data as any)?.rows || [];

  async function handleSave() {
    const name = draft.name.trim();
    if (!name || !draft.startDate || !draft.endDate) {
      setError('الرجاء تعبئة جميع الحقول.');
      return;
    }
    setError('');
    try {
      await mutations.saveHoliday.mutateAsync({ payload: { name, startDate: draft.startDate, endDate: draft.endDate } });
      setDraft({ name: '', startDate: '', endDate: '' });
      toast.success('تمت إضافة العطلة الرسمية بنجاح');
    } catch (e) {
      const msg = getErrorMessage(e, 'تعذر حفظ العطلة.');
      setError(msg);
      toast.error(msg);
    }
  }

  async function handleDelete(id: string) {
    const confirmed = await systemConfirm({
      title: 'تأكيد حذف العطلة',
      message: 'هل أنت متأكد من حذف هذه العطلة الرسمية؟ لن يتم احتسابها كعطلة في تقارير وسجلات الحضور مستقبلاً.',
    });
    if (!confirmed) return;
    try {
      await mutations.deleteHoliday.mutateAsync(id);
      toast.success('تم حذف العطلة بنجاح');
    } catch (e) {
      toast.error(getErrorMessage(e, 'تعذر حذف العطلة.'));
    }
  }

  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
        <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.95rem', color: '#0f172a' }}>
          <CalendarDaysIcon size={18} style={{ color: 'var(--primary, #170c5c)' }} />
          <span>{t('hr.settings.hr_settings_static_sections.s55', "العطلات الرسمية والإجازات العامة")}</span>
        </strong>
        <small style={{ color: '#64748b', fontSize: '0.775rem' }}>{t('hr.settings.hr_settings_static_sections.s56', "إدارة أيام العطلات الرسمية التي لا يُحتسب فيها غياب للموظفين.")}</small>
      </div>

      <QueryFeedback isLoading={holidaysQuery.isLoading} isError={holidaysQuery.isError} error={holidaysQuery.error} isEmpty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
          <div><label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '2px' }}>{t('hr.settings.hr_settings_static_sections.s57', "اسم العطلة")}</label><input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('hr.settings.hr_settings_static_sections.s58', "مثال: عيد الفطر")} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} /></div>
          <div><label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '2px' }}>{t('hr.settings.hr_settings_static_sections.s59', "من تاريخ")}</label><input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} /></div>
          <div><label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '2px' }}>{t('hr.settings.hr_settings_static_sections.s60', "إلى تاريخ")}</label><input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} /></div>
        </div>
        {error && <div style={{ color: '#dc2626', fontSize: '0.8rem' }}>{error}</div>}
        <div>
          <Button type="button" onClick={() => void handleSave()} disabled={mutations.saveHoliday.isPending} style={{ padding: '4px 14px', fontSize: '0.8rem' }}>
            {mutations.saveHoliday.isPending ? t('hr.settings.hr_settings_static_sections.s61', "جاري الحفظ...") : t('hr.settings.hr_settings_static_sections.s62', "حفظ العطلة")}
          </Button>
        </div>
        
        {holidays.length > 0 ? (
          <DataTable 
            rows={holidays} 
            rowKey={(row) => String(row.id)} 
            density="compact" 
            columns={[
              { key: 'name', header: t('hr.settings.hr_settings_static_sections.s63', "اسم العطلة"), cell: (row: any) => row.name },
              { key: 'startDate', header: t('hr.settings.hr_settings_static_sections.s64', "من تاريخ"), cell: (row: any) => row.startDate },
              { key: 'endDate', header: t('hr.settings.hr_settings_static_sections.s65', "إلى تاريخ"), cell: (row: any) => row.endDate },
              { key: 'actions', header: '', cell: (row: any) => (
                <Button type="button" variant="danger" onClick={() => void handleDelete(row.id)} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
                  {t('hr.settings.hr_settings_static_sections.s66', "حذف")}
                </Button>
              )}
            ]}
          />
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: '0.825rem' }}>{t('hr.settings.hr_settings_static_sections.s67', "لا توجد عطلات مسجلة.")}</p>
        )}
      </QueryFeedback>
    </div>
  );
}

export function HrSettingsOperationalNote() {
  return null;
}


