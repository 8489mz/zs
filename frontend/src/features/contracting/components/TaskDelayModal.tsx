import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import { toast } from '@/shared/components/system-alert';
import { contractingApi } from '../api/contracting.api';
import { ContractingScheduleTask } from '../contracting.types';
import { todayLocalDateKey } from '@/lib/format';

export type ShiftMode = 'current_only' | 'selected_tasks' | 'all_subsequent';

interface TaskDelayModalProps {
  open: boolean;
  task: ContractingScheduleTask | null;
  allTasks: ContractingScheduleTask[];
  projectId?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const DELAY_REASONS = [
  { value: 'تأخر اعتماد مخططات أو عينات من المالك / الاستشاري', label: 'تأخر اعتماد مخططات أو عينات من المالك / الاستشاري' },
  { value: 'تأخر صرف مستخلص أو دفعة مالية جارية للمقاول', label: 'تأخر صرف مستخلص أو دفعة مالية جارية للمقاول' },
  { value: 'أمر تغيير وتعديلات معمارية أو إنشائية (Variation Order)', label: 'أمر تغيير وتعديلات معمارية أو إنشائية (Variation Order)' },
  { value: 'تأخر توريد خامات كان متفقاً أن يوردها العميل', label: 'تأخر توريد خامات كان متفقاً أن يوردها العميل' },
  { value: 'تأخر مقاول باطن أو نقص عمالة فنية متخصصة', label: 'تأخر مقاول باطن أو نقص عمالة فنية متخصصة' },
  { value: 'أحوال جوية استثنائية أو ظروف قاهرة (Force Majeure)', label: 'أحوال جوية استثنائية أو ظروف قاهرة (Force Majeure)' },
  { value: 'توقف أمني أو تأخر تصاريح وتراخيص جهات حكومية', label: 'توقف أمني أو تأخر تصاريح وتراخيص جهات حكومية' },
  { value: 'سبب تنفيذي أو إداري آخر بالموقع', label: 'سبب تنفيذي أو إداري آخر بالموقع' },
];

const QUICK_DAYS = [1, 2, 3, 4, 5, 7, 10, 14, 21, 30];

function addDays(dateStr?: string | null, days: number = 0): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  d.setDate(d.getDate() + days);
  return todayLocalDateKey(d);
}

const getTaskStart = (t: any): string => t?.startDate || t?.start_date || '';
const getTaskEnd = (t: any): string => t?.endDate || t?.end_date || '';
const getTaskName = (t: any): string => t?.taskName || t?.task_name || '';
const getTaskCode = (t: any): string => t?.taskCode || t?.task_code || '';
const getTaskWbs = (t: any): string => t?.wbsCode || t?.wbs_code || '1.0';
const getTaskDuration = (t: any): number => Number(t?.durationDays ?? t?.duration_days ?? 1);

export function TaskDelayModal({
  open,
  task,
  allTasks,
  projectId,
  onClose,
  onSuccess,
}: TaskDelayModalProps) {
  const { t: __t } = useTranslation();
  const [delayDays, setDelayDays] = useState<number>(3);
  const [shiftMode, setShiftMode] = useState<ShiftMode>('all_subsequent');
  const [delayReason, setDelayReason] = useState<string>(DELAY_REASONS[0].value);
  const [customReason, setCustomReason] = useState<string>('');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [progressCount, setProgressCount] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // All other tasks sorted chronologically
  const otherTasks = useMemo(() => {
    if (!task) return [];
    return allTasks
      .filter((t) => t.id !== task.id)
      .sort((a, b) => getTaskStart(a).localeCompare(getTaskStart(b)));
  }, [allTasks, task]);

  // Subsequent tasks (tasks starting on or after current task start date)
  const subsequentTasks = useMemo(() => {
    if (!task) return [];
    const curStart = getTaskStart(task);
    return otherTasks.filter((t) => getTaskStart(t) >= curStart);
  }, [otherTasks, task]);

  // Filtered other tasks for checklist in Mode 2
  const filteredChecklistTasks = useMemo(() => {
    if (!searchFilter.trim()) return otherTasks;
    const q = searchFilter.toLowerCase().trim();
    return otherTasks.filter(
      (t) =>
        getTaskName(t).toLowerCase().includes(q) ||
        getTaskCode(t).toLowerCase().includes(q) ||
        getTaskWbs(t).toLowerCase().includes(q)
    );
  }, [otherTasks, searchFilter]);

  // Calculations for dates before and after
  const newEndDateForCurrent = useMemo(() => {
    if (!task) return '';
    const curEnd = getTaskEnd(task);
    return curEnd ? addDays(curEnd, delayDays) : '';
  }, [task, delayDays]);

  const maxEndDateBefore = useMemo(() => {
    return allTasks.reduce((max, t) => {
      const e = getTaskEnd(t);
      return e && e > max ? e : max;
    }, '');
  }, [allTasks]);

  const maxEndDateAfter = useMemo(() => {
    if (!task) return maxEndDateBefore;
    let max = maxEndDateBefore;
    if (newEndDateForCurrent && newEndDateForCurrent > max) max = newEndDateForCurrent;

    if (shiftMode === 'selected_tasks') {
      selectedTaskIds.forEach((id) => {
        const t = allTasks.find((x) => x.id === id);
        const e = t ? getTaskEnd(t) : '';
        if (e) {
          const shifted = addDays(e, delayDays);
          if (shifted > max) max = shifted;
        }
      });
    } else if (shiftMode === 'all_subsequent') {
      subsequentTasks.forEach((t) => {
        const e = getTaskEnd(t);
        if (e) {
          const shifted = addDays(e, delayDays);
          if (shifted > max) max = shifted;
        }
      });
    }

    return max;
  }, [task, maxEndDateBefore, newEndDateForCurrent, shiftMode, selectedTaskIds, allTasks, subsequentTasks, delayDays]);

  const affectedCount = useMemo(() => {
    if (shiftMode === 'current_only') return 1;
    if (shiftMode === 'selected_tasks') return 1 + selectedTaskIds.size;
    return 1 + subsequentTasks.length;
  }, [shiftMode, selectedTaskIds, subsequentTasks]);

  const toggleSelectTask = (id: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedTaskIds(new Set(filteredChecklistTasks.map((t) => t.id)));
  };

  const handleClearSelection = () => {
    setSelectedTaskIds(new Set());
  };

  const handleSaveDelay = async () => {
    if (!task || delayDays <= 0) return;
    setSaving(true);
    setErrorMsg(null);
    setProgressCount(0);

    try {
      const reasonFull = customReason.trim()
        ? `${delayReason} (${customReason.trim()})`
        : delayReason;

      const delayNote = `[إثبات تأخير +${delayDays} يوم | ${new Date().toISOString().slice(0, 10)} | السبب: ${reasonFull}]`;

      // 1. Update current task
      const updatedNotes = task.notes ? `${task.notes}\n${delayNote}` : delayNote;
      const curDur = getTaskDuration(task);
      const newDuration = curDur + delayDays;

      const currentTaskPayload: any = {
        durationDays: newDuration,
        status: 'delayed',
        notes: updatedNotes,
      };
      if (newEndDateForCurrent) {
        currentTaskPayload.endDate = newEndDateForCurrent;
      }

      await contractingApi.updateScheduleTask(task.id, currentTaskPayload);

      // 2. Identify tasks to shift
      let tasksToShift: ContractingScheduleTask[] = [];
      if (shiftMode === 'selected_tasks') {
        tasksToShift = otherTasks.filter((t) => selectedTaskIds.has(t.id));
      } else if (shiftMode === 'all_subsequent') {
        tasksToShift = subsequentTasks;
      }

      // 3. Batch shift affected tasks in chunks of 4
      if (tasksToShift.length > 0) {
        const chunkSize = 4;
        for (let i = 0; i < tasksToShift.length; i += chunkSize) {
          const chunk = tasksToShift.slice(i, i + chunkSize);
          await Promise.all(
            chunk.map((t) => {
              const shiftNote = `[تم ترحيل المواعيد +${delayDays} يوم تبعاً لتأخير البند ${getTaskCode(task)}]`;
              const nNotes = t.notes ? `${t.notes}\n${shiftNote}` : shiftNote;
              const tStart = getTaskStart(t);
              const tEnd = getTaskEnd(t);
              const tPayload: any = {
                notes: nNotes,
              };
              if (tStart) tPayload.startDate = addDays(tStart, delayDays);
              if (tEnd) tPayload.endDate = addDays(tEnd, delayDays);
              return contractingApi.updateScheduleTask(t.id, tPayload);
            })
          );
          setProgressCount(Math.min(i + chunkSize, tasksToShift.length));
        }
      }

      // 4. Update project end date if project is extended
      if (projectId && maxEndDateAfter && maxEndDateAfter > maxEndDateBefore) {
        try {
          await contractingApi.updateProject(projectId, {
            expectedEndDate: maxEndDateAfter,
          });
        } catch (pErr) {
          console.warn('Could not auto-update project end date:', pErr);
        }
      }

      toast.success(
        shiftMode === 'current_only'
          ? `تم تمديد مدة النشاط ${getTaskCode(task)} بمقدار ${delayDays} يوم بنجاح`
          : `تم ترحيل النشاط وعدد ${tasksToShift.length} نشاط لاحق بمقدار ${delayDays} يوم بنجاح`
      );

      onSuccess?.();
      onClose();
    } catch (err: any) {
      console.error('Failed to commit schedule delay:', err);
      setErrorMsg(err?.message || 'حدث خطأ أثناء ترحيل وحفظ مواعيد الجدول');
    } finally {
      setSaving(false);
    }
  };

  if (!task) return null;

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={__t('contracting.task_delay_modal.s0', "إثبات تأخير وترحيل مواعيد النشاط والجدول الزمني")}
      subtitle={`النشاط: ${getTaskName(task)} (${getTaskCode(task)}) | WBS: ${getTaskWbs(task)} | المدة الحالية: ${getTaskDuration(task)} يوم`}
      maxWidth="860px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
            {__t('contracting.task_delay_modal.s1', "سيتم تحديث وتعديل مواعيد")} <strong>{affectedCount} {__t('contracting.task_delay_modal.s2', "نشاط")}</strong> {__t('contracting.task_delay_modal.s3', "بالجدول الزمني.")}
            {saving && progressCount > 0 && (
              <span style={{ marginInlineStart: '8px', color: '#170e5e', fontWeight: 700 }}>
                {__t('contracting.task_delay_modal.s4', "(تم تحديث")} {progressCount} {__t('contracting.task_delay_modal.s5', "من")} {affectedCount - 1})
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#475569',
                fontSize: 'var(--font-body)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {__t('contracting.task_delay_modal.s6', "إلغاء")}
            </button>
            <button
              type="button"
              onClick={handleSaveDelay}
              disabled={saving || delayDays <= 0}
              style={{
                padding: '8px 22px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#170e5e',
                color: '#ffffff',
                fontSize: 'var(--font-body)',
                fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <AppIcons.Clock size={16} />
              <span>{saving ? __t('contracting.task_delay_modal.s7', "جارٍ ترحيل وحفظ المواعيد...") : __t('contracting.task_delay_modal.s8', "تثبيت واعتماد الترحيل الزمني")}</span>
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
        {errorMsg && (
          <div style={{ padding: '10px 14px', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 'var(--font-body)', fontWeight: 600 }}>
            {errorMsg}
          </div>
        )}

        {/* Section 1: Delay Days & Reason Inputs */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '14px', alignItems: 'start' }}>
            {/* Days Input */}
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                {__t('contracting.task_delay_modal.s9', "عدد أيام التأخير الإضافية *")}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={delayDays}
                  onChange={(e) => setDelayDays(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-section-title)',
                    fontWeight: 700,
                    color: '#c2410c',
                    textAlign: 'center',
                  }}
                />
                <span style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>
                  {__t('contracting.task_delay_modal.s10', "يوم")}
                </span>
              </div>

              {/* Quick Days Buttons */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                {QUICK_DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDelayDays(d)}
                    style={{
                      fontSize: '11px',
                      padding: '2px 7px',
                      borderRadius: '4px',
                      border: delayDays === d ? '1px solid #c2410c' : '1px solid #cbd5e1',
                      backgroundColor: delayDays === d ? '#fff7ed' : '#ffffff',
                      color: delayDays === d ? '#c2410c' : '#475569',
                      fontWeight: delayDays === d ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    +{d}
                  </button>
                ))}
              </div>
            </div>

            {/* Delay Reason Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                  {__t('contracting.task_delay_modal.s11', "سبب واقعة التأخير (مرجع تعاقدي للتوثيق)")}
                </label>
                <CustomSelect
                  options={DELAY_REASONS}
                  value={delayReason}
                  onChange={(val) => setDelayReason(val)}
                  placeholder={__t('contracting.task_delay_modal.s12', "اختر سبب واقعة التأخير...")}
                />
              </div>

              <div>
                <input
                  type="text"
                  placeholder={__t('contracting.task_delay_modal.s13', "ملاحظات تفصيلية أو رقم خطاب المالك / الاستشاري (اختياري)...")}
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  style={{
                    width: '100%',
                    height: '34px',
                    padding: '0 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: The 3 Shifting Options (The Contractor Request) */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--font-body)', fontWeight: 700, color: '#170e5e', marginBottom: '8px' }}>
            {__t('contracting.task_delay_modal.s14', "نطاق ترحيل الجدول الزمني المطلوب تطبيقه:")}
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            {/* Option 1: Current Task Only */}
            <div
              onClick={() => setShiftMode('current_only')}
              style={{
                padding: '12px 14px',
                borderRadius: '10px',
                border: shiftMode === 'current_only' ? '2px solid #170e5e' : '1px solid #e2e8f0',
                backgroundColor: shiftMode === 'current_only' ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#0f172a' }}>
                    {__t('contracting.task_delay_modal.s15', "1. البند الحالي فقط")}
                  </span>
                  <span style={{ fontSize: 'var(--font-micro)', padding: '2px 6px', borderRadius: '4px', background: '#f1f5f9', color: '#475569', fontWeight: 600 }}>
                    {__t('contracting.task_delay_modal.s16', "تعويض داخلي")}
                  </span>
                </div>
                <p style={{ fontSize: 'var(--font-micro)', color: '#64748b', margin: 0, lineHeight: 1.4 }}>
                  {__t('contracting.task_delay_modal.s17', "زيادة مدة هذا البند (+")}{delayDays} {__t('contracting.task_delay_modal.s18', "يوم) دون المساس بباقي مواعيد الجدول الزمني للمشروع.")}
                </p>
              </div>
            </div>

            {/* Option 2: Current Task + Selected Dependent Tasks */}
            <div
              onClick={() => setShiftMode('selected_tasks')}
              style={{
                padding: '12px 14px',
                borderRadius: '10px',
                border: shiftMode === 'selected_tasks' ? '2px solid #170e5e' : '1px solid #e2e8f0',
                backgroundColor: shiftMode === 'selected_tasks' ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#0f172a' }}>
                    {__t('contracting.task_delay_modal.s19', "2. الحالي وبنود محددة معه")}
                  </span>
                  <span style={{ fontSize: 'var(--font-micro)', padding: '2px 6px', borderRadius: '4px', background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
                    {__t('contracting.task_delay_modal.s20', "ربط انتقائي")}
                  </span>
                </div>
                <p style={{ fontSize: 'var(--font-micro)', color: '#64748b', margin: 0, lineHeight: 1.4 }}>
                  {__t('contracting.task_delay_modal.s21', "ترحيل هذا البند مع اختيار حزم أو أنشطة معينة متأثرة به فقط دون التأثير على باقي المشروع.")}
                </p>
              </div>
            </div>

            {/* Option 3: All Subsequent Tasks */}
            <div
              onClick={() => setShiftMode('all_subsequent')}
              style={{
                padding: '12px 14px',
                borderRadius: '10px',
                border: shiftMode === 'all_subsequent' ? '2px solid #170e5e' : '1px solid #e2e8f0',
                backgroundColor: shiftMode === 'all_subsequent' ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#0f172a' }}>
                    {__t('contracting.task_delay_modal.s22', "3. ترحيل شامل لكل ما يليه")}
                  </span>
                  <span style={{ fontSize: 'var(--font-micro)', padding: '2px 6px', borderRadius: '4px', background: '#fee2e2', color: '#991b1b', fontWeight: 700 }}>
                    {__t('contracting.task_delay_modal.s23', "مسار حرج CPM")}
                  </span>
                </div>
                <p style={{ fontSize: 'var(--font-micro)', color: '#64748b', margin: 0, lineHeight: 1.4 }}>
                  {__t('contracting.task_delay_modal.s24', "تزحيف كافة الأنشطة اللاحقة (+")}{delayDays} {__t('contracting.task_delay_modal.s25', "يوم) وترحيل موعد تسليم المشروع النهائي تلقائياً.")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Option 2 Checklist Area (Only visible when selected_tasks is active) */}
        {shiftMode === 'selected_tasks' && (
          <div style={{ border: '1px solid #cbd5e1', borderRadius: '8px', padding: '12px', background: '#ffffff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '10px' }}>
              <span style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#1e293b' }}>
                {__t('contracting.task_delay_modal.s26', "حدد الأنشطة المرتبطة المطلوب ترحيلها مع هذا البند (")}{selectedTaskIds.size} {__t('contracting.task_delay_modal.s27', "محددة):")}
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={handleSelectAllVisible}
                  style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 600 }}
                >
                  {__t('contracting.task_delay_modal.s28', "تحديد الكل")}
                </button>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', color: '#64748b' }}
                >
                  {__t('contracting.task_delay_modal.s29', "إلغاء التحديد")}
                </button>
              </div>
            </div>

            {/* Quick search */}
            <input
              type="text"
              placeholder={__t('contracting.task_delay_modal.s30', "بحث في الأنشطة بالاسم أو الكود...")}
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{
                width: '100%',
                height: '32px',
                padding: '0 8px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
                fontSize: 'var(--font-micro)',
                marginBottom: '8px',
              }}
            />

            <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #f1f5f9', borderRadius: '6px' }}>
              {filteredChecklistTasks.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', fontSize: 'var(--font-micro)', color: '#94a3b8' }}>
                  {__t('contracting.task_delay_modal.s31', "لا توجد أنشطة مطابقة للبحث")}
                </div>
              ) : (
                filteredChecklistTasks.map((t) => {
                  const isChecked = selectedTaskIds.has(t.id);
                  return (
                    <div
                      key={t.id}
                      onClick={() => toggleSelectTask(t.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        borderBottom: '1px solid #f8fafc',
                        backgroundColor: isChecked ? '#f0fdf4' : '#ffffff',
                        cursor: 'pointer',
                      }}
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 'var(--font-body)' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // handled by row click
                        />
                        <span style={{ fontWeight: 700, color: '#170e5e', minWidth: '60px', fontSize: 'var(--font-micro)' }}>
                          {t.taskCode || t.wbsCode}
                        </span>
                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{t.taskName}</span>
                      </label>

                      <div style={{ fontSize: 'var(--font-micro)', color: isChecked ? '#166534' : '#64748b' }}>
                        <span>{__t('contracting.task_delay_modal.s32', "من")} {getTaskStart(t) || '-'} {__t('contracting.task_delay_modal.s33', "إلى")} {getTaskEnd(t) || '-'}</span>
                        {isChecked && (
                          <span style={{ marginInlineStart: '6px', fontWeight: 700 }}>
                            {__t('contracting.task_delay_modal.s34', "➔ ستصبح إلى:")} {addDays(getTaskEnd(t), delayDays)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Section 3: Live Impact Preview Card */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px' }}>
          <h4 style={{ fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#1e293b', margin: '0 0 8px 0' }}>
            {__t('contracting.task_delay_modal.s35', "معاينة الأثر الزمني على المشروع والأنشطة:")}
          </h4>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px' }}>
              <div style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>{__t('contracting.task_delay_modal.s36', "نهاية البند الحالي المعدلة")}</div>
              <div style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#c2410c', marginTop: '2px' }}>
                {newEndDateForCurrent || '-'} {__t('contracting.task_delay_modal.s37', "(بدلاً من")} {getTaskEnd(task) || '-'})
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                {__t('contracting.task_delay_modal.s38', "المدة الجديدة:")} {getTaskDuration(task) + delayDays} {__t('contracting.task_delay_modal.s39', "يوم (+")}{delayDays})
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px' }}>
              <div style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>{__t('contracting.task_delay_modal.s40', "إجمالي الأنشطة المتأثرة بالترحيل")}</div>
              <div style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#170e5e', marginTop: '2px' }}>
                {affectedCount} {__t('contracting.task_delay_modal.s41', "نشاط")}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                {shiftMode === 'current_only'
                  ? __t('contracting.task_delay_modal.s42', "هذا البند فقط دون غيره")
                  : shiftMode === 'selected_tasks'
                  ? __t('contracting.task_delay_modal.s43', "البند الحالي + الأنشطة المختارة")
                  : __t('contracting.task_delay_modal.s44', "البند الحالي وكافة الأنشطة اللاحقة")}
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px' }}>
              <div style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>{__t('contracting.task_delay_modal.s45', "تاريخ تسليم المشروع النهائي")}</div>
              <div style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: maxEndDateAfter > maxEndDateBefore ? '#dc2626' : '#15803d', marginTop: '2px' }}>
                {maxEndDateAfter || '-'}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                {maxEndDateAfter > maxEndDateBefore
                  ? `تمديد تسليم المشروع بـ ${delayDays} يوم`
                  : __t('contracting.task_delay_modal.s46', "موعد تسليم المشروع لا يتأثر")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </StandardDialog>
  );
}
