import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { contractingApi } from '../api/contracting.api';
import { CustomSelect } from '@/shared/ui/custom-select';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { ContractingBoqItem, ContractingScheduleTask } from '../contracting.types';
import { addDaysLocalDateKey, todayLocalDateKey } from '@/lib/format';

interface CreateScheduleTaskModalProps {
  open: boolean;
  projectId: string;
  projectName?: string;
  boqItems?: ContractingBoqItem[];
  existingTasks?: ContractingScheduleTask[];
  onClose: () => void;
  onCreated?: () => void;
  onSuccess?: () => void;
}

export function CreateScheduleTaskModal({
  open,
  projectId,
  projectName,
  boqItems = [],
  existingTasks = [],
  onClose,
  onCreated,
}: CreateScheduleTaskModalProps) {
  const { t: __t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    taskCode: '',
    taskName: '',
    wbsCode: '1.0',
    startDate: todayLocalDateKey(),
    endDate: addDaysLocalDateKey(7),
    durationDays: '7',
    progressPercent: '0',
    predecessorId: '',
    isCriticalPath: false,
    status: 'not_started',
    boqItemId: '',
    assignedTeam: '',
    plannedManpowerCount: '',
    plannedEquipmentCount: '',
    resourceTrade: '',
    notes: '',
  });

  const handleStartDateChange = (val: string) => {
    const s = new Date(val);
    const e = new Date(formData.endDate);
    let diff = 1;
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && e >= s) {
      diff = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)));
    }
    setFormData({ ...formData, startDate: val, durationDays: String(diff) });
  };

  const handleEndDateChange = (val: string) => {
    const s = new Date(formData.startDate);
    const e = new Date(val);
    let diff = 1;
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && e >= s) {
      diff = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)));
    }
    setFormData({ ...formData, endDate: val, durationDays: String(diff) });
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formData.taskName.trim()) {
      setErrorMsg('يرجى إدخال اسم أو بيان المهمة التنفيذية');
      return;
    }
    if (!formData.startDate || !formData.endDate) {
      setErrorMsg('يرجى تحديد تواريخ البداية والنهاية للمهمة');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await contractingApi.createScheduleTask(projectId, {
        taskCode: formData.taskCode.trim() || undefined,
        taskName: formData.taskName.trim(),
        wbsCode: formData.wbsCode.trim() || '1.0',
        startDate: formData.startDate,
        endDate: formData.endDate,
        durationDays: Number(formData.durationDays || 1),
        progressPercent: Number(formData.progressPercent || 0),
        predecessorId: formData.predecessorId || undefined,
        isCriticalPath: formData.isCriticalPath,
        status: formData.status as any,
        boqItemId: formData.boqItemId || undefined,
        assignedTeam: formData.assignedTeam.trim() || undefined,
        plannedManpowerCount: formData.plannedManpowerCount ? Number(formData.plannedManpowerCount) : undefined,
        plannedEquipmentCount: formData.plannedEquipmentCount ? Number(formData.plannedEquipmentCount) : undefined,
        resourceTrade: formData.resourceTrade.trim() || undefined,
        notes: formData.notes.trim() || undefined,
      });
      onCreated?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ أثناء حفظ المهمة الجدولية');
    } finally {
      setIsSubmitting(false);
    }
  };

  const boqSelectOptions = [
    { value: '', label: '-- بدون ربط مباشر ببند مقايسة --' },
    ...boqItems.map((b) => ({
      value: b.id,
      label: `${b.itemCode} - ${b.description.substring(0, 45)}`,
    })),
  ];

  const predecessorSelectOptions = [
    { value: '', label: '-- لا يوجد اعتمادية سابقة (تبدأ مباشرة) --' },
    ...existingTasks.map((t) => ({
      value: t.id,
      label: `${t.taskCode || ''} - ${t.taskName} (${t.durationDays} يوم)`,
    })),
  ];

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={__t('contracting.create_schedule_task_modal.s0', "إضافة مهمة جدولية ومرحلة تنفيذية (Schedule Task)")}
      subtitle={projectName ? `المشروع: ${projectName}` : __t('contracting.create_schedule_task_modal.s1', "جدولة الأعمال وتحديد مدد التنفيذ والمسار الحرج (CPM)")}
      width="min(880px, 95vw)"
      minHeight="auto"
      footerActions={(
        <StandardDialogFooter
          onCancel={onClose}
          onSubmit={() => handleSubmit()}
          submitText={__t('contracting.create_schedule_task_modal.s2', "إضافة المهمة للجدول الزمني")}
          isSubmitting={isSubmitting}
        />
      )}
    >
      <style>{`
        .task-compact-modal .field {
          margin-bottom: 0 !important;
          gap: 3px !important;
        }
        .task-compact-modal .field span {
          font-size: 0.74rem !important;
          font-weight: 600 !important;
          color: #334155 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        .task-compact-modal input,
        .task-compact-modal textarea {
          height: 33px !important;
          font-size: 0.8125rem !important;
          border-radius: 6px !important;
          padding: 0 10px !important;
          border: 1px solid #cbd5e1 !important;
          background: #ffffff !important;
          box-sizing: border-box !important;
          outline: none !important;
          width: 100% !important;
          transition: border-color 0.15s, box-shadow 0.15s !important;
        }
        .task-compact-modal input:focus,
        .task-compact-modal textarea:focus {
          border-color: #170e5e !important;
          box-shadow: 0 0 0 2px rgba(23, 14, 94, 0.1) !important;
        }
        .task-compact-modal .custom-select-trigger {
          min-height: 33px !important;
          height: 33px !important;
          font-size: 0.8125rem !important;
          padding: 0 10px !important;
          border-radius: 6px !important;
          border: 1px solid #cbd5e1 !important;
        }
      `}</style>

      <form onSubmit={handleSubmit} className="task-compact-modal" style={{ display: 'flex', flexDirection: 'column', gap: '9px' }} dir="rtl">
        {errorMsg && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              color: '#991b1b',
              fontSize: '0.8rem',
              fontWeight: 600,
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* 1. توصيف النشاط التنفيذي ومستوى WBS */}
        <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.Layers size={15} />
            <span>{__t('contracting.create_schedule_task_modal.s3', "1. توصيف النشاط التنفيذي ومستوى WBS (Task Scope & Breakdown)")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr 1.5fr', gap: '10px', alignItems: 'start' }}>
            <Field label={__t('contracting.create_schedule_task_modal.s4', "كود هيكل الأعمال (WBS)")}>
              <input
                type="text"
                value={formData.wbsCode}
                onChange={(e) => setFormData({ ...formData, wbsCode: e.target.value })}
                placeholder={__t('contracting.create_schedule_task_modal.s5', "مثال: 1.1.2")}
                style={{ fontFamily: 'monospace', fontWeight: 600 }}
              />
            </Field>

            <Field label={__t('contracting.create_schedule_task_modal.s6', "كود المهمة")}>
              <input
                type="text"
                value={formData.taskCode}
                onChange={(e) => setFormData({ ...formData, taskCode: e.target.value })}
                placeholder={__t('contracting.create_schedule_task_modal.s7', "تلقائي: TSK-001")}
                style={{ fontFamily: 'monospace', fontWeight: 600 }}
              />
            </Field>

            <Field label={__t('contracting.create_schedule_task_modal.s8', "اسم المهمة أو النشاط التنفيذي *")}>
              <input
                type="text"
                value={formData.taskName}
                onChange={(e) => setFormData({ ...formData, taskName: e.target.value })}
                placeholder={__t('contracting.create_schedule_task_modal.s9', "مثال: أعمال الحفر والإحلال للموقع العام")}
                required
              />
            </Field>

            <Field label={__t('contracting.create_schedule_task_modal.s10', "الفريق أو المقاول المسؤول")}>
              <input
                type="text"
                value={formData.assignedTeam}
                onChange={(e) => setFormData({ ...formData, assignedTeam: e.target.value })}
                placeholder={__t('contracting.create_schedule_task_modal.s11', "مثال: طاقم الخرسانات...")}
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: '10px', marginTop: '8px' }}>
            <Field label={__t('contracting.create_schedule_task_modal.s12', "عدد العمالة المخططة")}>
              <input
                type="number"
                min={0}
                value={formData.plannedManpowerCount}
                onChange={(e) => setFormData({ ...formData, plannedManpowerCount: e.target.value })}
                placeholder="0"
              />
            </Field>
            <Field label={__t('contracting.create_schedule_task_modal.s13', "عدد المعدات المخططة")}>
              <input
                type="number"
                min={0}
                value={formData.plannedEquipmentCount}
                onChange={(e) => setFormData({ ...formData, plannedEquipmentCount: e.target.value })}
                placeholder="0"
              />
            </Field>
            <Field label={__t('contracting.create_schedule_task_modal.s14', "التخصص/الحرفة (لتقرير تحميل الموارد)")}>
              <input
                type="text"
                value={formData.resourceTrade}
                onChange={(e) => setFormData({ ...formData, resourceTrade: e.target.value })}
                placeholder={__t('contracting.create_schedule_task_modal.s15', "مثال: حدادة مسلحة، تشطيبات...")}
              />
            </Field>
          </div>
        </div>

        {/* 2. المواعيد الزمنية والمدد التنفيذية */}
        <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.Calendar size={15} />
            <span>{__t('contracting.create_schedule_task_modal.s16', "2. المواعيد الزمنية والمسار الحرج (Timeline & Critical Path)")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 1fr 1.5fr', gap: '10px', alignItems: 'center' }}>
            <Field label={__t('contracting.create_schedule_task_modal.s17', "تاريخ البداية *")}>
              <input
                type="date"
                value={formData.startDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                required
              />
            </Field>

            <Field label={__t('contracting.create_schedule_task_modal.s18', "تاريخ النهاية *")}>
              <input
                type="date"
                value={formData.endDate}
                onChange={(e) => handleEndDateChange(e.target.value)}
                required
              />
            </Field>

            <Field label={__t('contracting.create_schedule_task_modal.s19', "مدة التنفيذ (أيام)")}>
              <input
                type="number"
                min="1"
                dir="ltr"
                value={formData.durationDays}
                onChange={(e) => setFormData({ ...formData, durationDays: e.target.value })}
                style={{ fontWeight: 700 }}
              />
            </Field>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, color: formData.isCriticalPath ? '#b91c1c' : '#334155' }}>
                <input
                  type="checkbox"
                  checked={formData.isCriticalPath}
                  onChange={(e) => setFormData({ ...formData, isCriticalPath: e.target.checked })}
                  style={{ width: '16px', height: '16px', accentColor: '#dc2626' }}
                />
                <span>{__t('contracting.create_schedule_task_modal.s20', "نشاط مسار حرج (Critical Path CPM)")}</span>
              </label>
            </div>
          </div>
        </div>

        {/* 3. الاعتماديات وبنود المقايسة والملاحظات */}
        <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.Tag size={14} />
            <span>{__t('contracting.create_schedule_task_modal.s21', "3. الاعتماديات وبنود المقايسة والملاحظات (Dependencies & Allocation)")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignItems: 'start', marginBottom: '8px' }}>
            <Field label={__t('contracting.create_schedule_task_modal.s22', "ربط ببند المقايسة (BOQ Item)")}>
              <CustomSelect
                value={formData.boqItemId}
                options={boqSelectOptions}
                onChange={(val) => setFormData({ ...formData, boqItemId: val })}
              />
            </Field>

            <Field label={__t('contracting.create_schedule_task_modal.s23', "المهمة السابقة المعتمدة عليها (Predecessor)")}>
              <CustomSelect
                value={formData.predecessorId}
                options={predecessorSelectOptions}
                onChange={(val) => setFormData({ ...formData, predecessorId: val })}
              />
            </Field>
          </div>

          <Field label={__t('contracting.create_schedule_task_modal.s24', "ملاحظات ومتطلبات التنفيذ (اختياري)")}>
            <input
              type="text"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder={__t('contracting.create_schedule_task_modal.s25', "ملاحظات مهندس التخطيط، اعتمادات الاستشاري المطلوبة قبل البدء...")}
            />
          </Field>
        </div>
      </form>
    </StandardDialog>
  );
}
