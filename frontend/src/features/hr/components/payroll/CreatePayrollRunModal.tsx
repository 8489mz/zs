import { useTranslation } from 'react-i18next';
import React, { useEffect, useMemo } from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { useServerClock } from '@/shared/hooks/use-server-clock';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { XIcon, CheckCircleIcon, AlertCircleIcon, CalendarIcon, InfoIcon } from '@/shared/components/icons/AppIcons';
import { todayLocalDateKey } from '@/lib/format';

export interface PayrollDraft {
  periodMonth: string;
  payFrequency: 'monthly' | 'weekly' | 'biweekly' | 'daily' | 'all';
  startDate: string;
  endDate: string;
  notes: string;
}

interface CreatePayrollRunModalProps {
  isOpen: boolean;
  onClose: () => void;
  draft: PayrollDraft;
  onDraftChange: React.Dispatch<React.SetStateAction<PayrollDraft>>;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
  canManagePayroll: boolean;
  hasCreatePayrollRun: boolean;
  formError: string;
  employees?: Array<{ payFrequency?: string; status?: string; displayName?: string }>;
  isEgypt?: boolean;
  /** Server instant (ISO) from the page's payroll-runs list response. */
  serverTime?: string;
  /** Tenant zone from the page's payroll-runs list response. */
  serverTimezone?: string;
}

function getMonthDetails(monthStr: string) {
  if (!monthStr || !monthStr.includes('-')) return { start: '', end: '', lastDay: 30 };
  const parts = monthStr.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (isNaN(year) || isNaN(month)) return { start: '', end: '', lastDay: 30 };
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${monthStr}-01`,
    end: `${monthStr}-${String(lastDay).padStart(2, '0')}`,
    lastDay,
  };
}

export function CreatePayrollRunModal({
  isOpen,
  onClose,
  draft,
  onDraftChange,
  onSubmit,
  isPending,
  canManagePayroll,
  hasCreatePayrollRun,
  formError,
  employees = [],
  isEgypt = false,
  serverTime,
  serverTimezone,
}: CreatePayrollRunModalProps) {
  const { t } = useTranslation();
  const serverClock = useServerClock(serverTime, serverTimezone);

  // Terminology based on regional settings (Egypt vs Gulf/Other)
  const payrollTerm = isEgypt ? 'كشف المرتبات' : 'مسير الرواتب';
  const payrollAction = isEgypt ? 'تجهيز كشف المرتبات' : 'تجهيز مسير الرواتب';
  const payrollMonthLabel = isEgypt ? 'شهر كشف المرتبات *' : 'شهر مسير الرواتب *';

  // Auto-fill dates if empty when month exists
  useEffect(() => {
    if (isOpen && draft.periodMonth && (!draft.startDate || !draft.endDate)) {
      const { start, end } = getMonthDetails(draft.periodMonth);
      onDraftChange((prev) => ({
        ...prev,
        startDate: prev.startDate || start,
        endDate: prev.endDate || end,
        payFrequency: prev.payFrequency || 'monthly',
      }));
    }
  }, [isOpen, draft.periodMonth, onDraftChange]);

  const activeEmployees = useMemo(() => {
    return employees.filter((e) => (e.status || 'active') === 'active');
  }, [employees]);

  const frequencyCounts = useMemo(() => {
    let monthly = 0;
    let weekly = 0;
    let biweekly = 0;
    let daily = 0;
    for (const emp of activeEmployees) {
      const freq = (emp.payFrequency || 'monthly').toLowerCase();
      if (freq === 'weekly') weekly++;
      else if (freq === 'biweekly') biweekly++;
      else if (freq === 'daily') daily++;
      else monthly++;
    }
    return {
      monthly,
      weekly,
      biweekly,
      daily,
      all: activeEmployees.length,
    };
  }, [activeEmployees]);

  const selectedTargetCount = useMemo(() => {
    const freq = draft.payFrequency || 'monthly';
    return frequencyCounts[freq] ?? 0;
  }, [draft.payFrequency, frequencyCounts]);

  const monthInfo = useMemo(() => {
    return getMonthDetails(draft.periodMonth);
  }, [draft.periodMonth]);

  if (!isOpen) return null;

  const handleMonthChange = (val: string) => {
    const { start, end } = getMonthDetails(val);
    onDraftChange((prev) => ({
      ...prev,
      periodMonth: val,
      startDate: start,
      endDate: end,
    }));
  };

  const handleFrequencyChange = (newFreq: 'monthly' | 'weekly' | 'biweekly' | 'daily' | 'all') => {
    const { lastDay } = monthInfo;
    const m = draft.periodMonth;

    let newStart = draft.startDate;
    let newEnd = draft.endDate;

    if (m) {
      if (newFreq === 'monthly' || newFreq === 'all') {
        newStart = `${m}-01`;
        newEnd = `${m}-${String(lastDay).padStart(2, '0')}`;
      } else if (newFreq === 'biweekly') {
        // Default to first half of the month
        newStart = `${m}-01`;
        newEnd = `${m}-15`;
      } else if (newFreq === 'weekly') {
        // Default to first week of the month
        newStart = `${m}-01`;
        newEnd = `${m}-07`;
      } else if (newFreq === 'daily') {
        // P8 (RC-7): the daily-run "today" comes from the server day in
        // the tenant zone — the old default was a UTC slice, yesterday
        // for the first two hours after midnight (UTC+2).
        const todayStr = serverClock.todayKey() || todayLocalDateKey();
        const isCurrentMonth = todayStr.startsWith(m);
        const dayStr = isCurrentMonth ? todayStr.slice(8, 10) : '01';
        newStart = `${m}-${dayStr}`;
        newEnd = `${m}-${dayStr}`;
      }
    }

    onDraftChange((prev) => ({
      ...prev,
      payFrequency: newFreq,
      startDate: newStart,
      endDate: newEnd,
    }));
  };

  const setPresetDates = (startDay: number, endDay: number) => {
    if (!draft.periodMonth) return;
    const s = `${draft.periodMonth}-${String(startDay).padStart(2, '0')}`;
    const e = `${draft.periodMonth}-${String(endDay).padStart(2, '0')}`;
    onDraftChange((prev) => ({
      ...prev,
      startDate: s,
      endDate: e,
    }));
  };

  const frequencyOptions = [
    { value: 'monthly', label: `شهري (${frequencyCounts.monthly} موظف)`, hint: 'الرواتب الشهرية المنتظمة' },
    { value: 'biweekly', label: `نصف شهري (${frequencyCounts.biweekly} موظف)`, hint: 'دفعات كل 15 يوماً' },
    { value: 'weekly', label: `أسبوعي (${frequencyCounts.weekly} موظف)`, hint: 'أجور أسبوعية' },
    { value: 'daily', label: `يومي (${frequencyCounts.daily} موظف)`, hint: 'يوميات وعمالة متغيرة' },
    { value: 'all', label: `شامل (${frequencyCounts.all} موظف)`, hint: 'كافة الموظفين بغض النظر عن الدورة' },
  ];

  return (
    <DialogShell open={true} onClose={onClose} width="600px">
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Standard Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            background: '#ffffff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                width: '4px',
                height: '18px',
                backgroundColor: '#170e5e',
                borderRadius: '2px',
                display: 'inline-block',
              }}
            />
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                {isEgypt ? 'إنشاء وتجهيز كشف المرتبات' : 'تجهيز مسير الرواتب'}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                {t('hr.payroll.create_payroll_run_modal.subtitle', 'احتساب الرواتب والبدلات وجزاءات الحضور وأقساط السلف آلياً وفق دورة القبض المحددة')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#94a3b8',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
            }}
          >
            <XIcon size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {hasCreatePayrollRun && canManagePayroll ? (
            <form id="create-payroll-form" onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Row 1: Month and Frequency */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    {payrollMonthLabel}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="month"
                      value={draft.periodMonth}
                      onChange={(e) => handleMonthChange(e.target.value)}
                      required
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        color: '#0f172a',
                        background: '#ffffff',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    {t('hr.payroll.create_payroll_run_modal.freq', 'دورة القبض المستهدفة *')}
                  </label>
                  <CustomSelect
                    value={draft.payFrequency || 'monthly'}
                    onChange={(val) => handleFrequencyChange(val as any)}
                    options={frequencyOptions}
                  />
                </div>
              </div>

              {/* Smart Quick Period Presets */}
              {draft.periodMonth && (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <CalendarIcon size={14} color="#64748b" />
                      فترات وتواريخ دورة القبض السريعة:
                    </span>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                      (يمكنك الضغط لضبط التواريخ تلقائياً)
                    </span>
                  </div>

                  {draft.payFrequency === 'biweekly' ? (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => setPresetDates(1, 15)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          background: draft.startDate.endsWith('-01') && draft.endDate.endsWith('-15') ? '#170e5e' : '#ffffff',
                          color: draft.startDate.endsWith('-01') && draft.endDate.endsWith('-15') ? '#ffffff' : '#334155',
                          border: '1px solid #cbd5e1',
                        }}
                      >
                        النصف الأول (1 - 15)
                      </button>
                      <button
                        type="button"
                        onClick={() => setPresetDates(16, monthInfo.lastDay)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          background: draft.startDate.endsWith('-16') && draft.endDate.endsWith(`-${String(monthInfo.lastDay).padStart(2, '0')}`) ? '#170e5e' : '#ffffff',
                          color: draft.startDate.endsWith('-16') && draft.endDate.endsWith(`-${String(monthInfo.lastDay).padStart(2, '0')}`) ? '#ffffff' : '#334155',
                          border: '1px solid #cbd5e1',
                        }}
                      >
                        النصف الثاني (16 - {monthInfo.lastDay})
                      </button>
                    </div>
                  ) : draft.payFrequency === 'weekly' ? (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {[
                        { label: 'الأسبوع 1 (1 - 7)', s: 1, e: 7 },
                        { label: 'الأسبوع 2 (8 - 14)', s: 8, e: 14 },
                        { label: 'الأسبوع 3 (15 - 21)', s: 15, e: 21 },
                        { label: `الأسبوع 4 (22 - ${monthInfo.lastDay})`, s: 22, e: monthInfo.lastDay },
                      ].map((w, idx) => {
                        const isSelected = draft.startDate.endsWith(`-${String(w.s).padStart(2, '0')}`) && draft.endDate.endsWith(`-${String(w.e).padStart(2, '0')}`);
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setPresetDates(w.s, w.e)}
                            style={{
                              padding: '4px 8px',
                              borderRadius: '6px',
                              fontSize: '0.725rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              background: isSelected ? '#170e5e' : '#ffffff',
                              color: isSelected ? '#ffffff' : '#334155',
                              border: '1px solid #cbd5e1',
                            }}
                          >
                            {w.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : draft.payFrequency === 'daily' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => {
                            // P8 (RC-7): "today only" is the server day in the tenant zone.
                            const todayStr = serverClock.todayKey() || todayLocalDateKey();
                            const isCurrentMonth = todayStr.startsWith(draft.periodMonth);
                            const dayNum = isCurrentMonth ? parseInt(todayStr.slice(8, 10), 10) : 1;
                            setPresetDates(dayNum, dayNum);
                          }}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            background: draft.startDate === draft.endDate ? '#170e5e' : '#ffffff',
                            color: draft.startDate === draft.endDate ? '#ffffff' : '#334155',
                            border: '1px solid #cbd5e1',
                          }}
                        >
                          اليوم فقط (يومية فورية: يوم بيومه)
                        </button>
                        <button
                          type="button"
                          onClick={() => setPresetDates(1, monthInfo.lastDay)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            background: draft.startDate.endsWith('-01') && draft.endDate.endsWith(`-${String(monthInfo.lastDay).padStart(2, '0')}`) && draft.startDate !== draft.endDate ? '#170e5e' : '#ffffff',
                            color: draft.startDate.endsWith('-01') && draft.endDate.endsWith(`-${String(monthInfo.lastDay).padStart(2, '0')}`) && draft.startDate !== draft.endDate ? '#ffffff' : '#334155',
                            border: '1px solid #cbd5e1',
                          }}
                        >
                          تصفية الشهر مجمعة (1 - {monthInfo.lastDay})
                        </button>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <InfoIcon size={13} color="#64748b" />
                        {draft.startDate === draft.endDate ? (
                          <span>نمط الصرف: <strong>يومية فورية ليوم واحد</strong> ({draft.startDate}). سيتم احتساب حضور ذلك اليوم فقط.</span>
                        ) : (
                          <span>نمط الصرف: <strong>تصفية يوميات مجمعة</strong> من ({draft.startDate}) إلى ({draft.endDate}). سيتم احتساب إجمالي ساعات وأيام الفترة.</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setPresetDates(1, monthInfo.lastDay)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          background: '#170e5e',
                          color: '#ffffff',
                          border: '1px solid #170e5e',
                        }}
                      >
                        الشهر بالكامل (1 - {monthInfo.lastDay})
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Operational Live Target Banner */}
              {selectedTargetCount > 0 ? (
                <div
                  style={{
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <CheckCircleIcon size={18} color="#16a34a" />
                  <div>
                    <div style={{ fontSize: '0.825rem', fontWeight: 800, color: '#166534' }}>
                      جاهز للاحتساب: {selectedTargetCount} موظف نشط في هذه الدورة
                    </div>
                    <div style={{ fontSize: '0.725rem', color: '#15803d', marginTop: '1px' }}>
                      سيتم احتساب الراتب التناسبي للفترة المحددة، والبدلات، وجزاءات الحضور، وأقساط السلف آلياً.
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <AlertCircleIcon size={18} color="#dc2626" />
                  <div>
                    <div style={{ fontSize: '0.825rem', fontWeight: 800, color: '#991b1b' }}>
                      تنبيه: لا يوجد موظفون مسجلون بهذه الدورة ({draft.payFrequency})
                    </div>
                    <div style={{ fontSize: '0.725rem', color: '#b91c1c', marginTop: '1px' }}>
                      إذا قمت بالتجهيز الآن سيكون {payrollTerm} فارغاً (0 موظف). اختر دورة أخرى أو "شامل" لتضمين موظفيك.
                    </div>
                  </div>
                </div>
              )}

              {/* Row 2: Date Range */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    {t('hr.payroll.create_payroll_run_modal.start_date', 'تاريخ بداية الفترة')}
                  </label>
                  <input
                    type="date"
                    value={draft.startDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      onDraftChange((prev) => ({
                        ...prev,
                        startDate: val,
                        endDate: prev.payFrequency === 'daily' && prev.startDate === prev.endDate ? val : prev.endDate,
                      }));
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.825rem',
                      background: '#ffffff',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    {t('hr.payroll.create_payroll_run_modal.end_date', 'تاريخ نهاية الفترة')}
                  </label>
                  <input
                    type="date"
                    value={draft.endDate}
                    onChange={(e) => onDraftChange((prev) => ({ ...prev, endDate: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.825rem',
                      background: '#ffffff',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Row 3: Notes */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  {t('hr.payroll.create_payroll_run_modal.notes', 'ملاحظات إدارية (اختياري)')}
                </label>
                <input
                  value={draft.notes}
                  placeholder={
                    draft.payFrequency === 'daily'
                      ? (isEgypt ? 'مثال: كشف يوميات العمالة ليوم 1 أكتوبر...' : 'مثال: مسير يومية العمالة...')
                      : draft.payFrequency === 'weekly'
                      ? (isEgypt ? 'مثال: كشف مرتبات الأسبوع الأول من شهر أكتوبر...' : 'مثال: مسير رواتب الأسبوع الأول...')
                      : draft.payFrequency === 'biweekly'
                      ? (isEgypt ? 'مثال: كشف مرتبات النصف الأول من شهر أكتوبر...' : 'مثال: مسير رواتب النصف الأول...')
                      : (isEgypt
                          ? 'مثال: كشف مرتبات شهر أكتوبر بعد مراجعة الحضور والخصومات والسلف...'
                          : 'مثال: مسير رواتب شهر أكتوبر بعد مراجعة البصمة والسلف...')
                  }
                  onChange={(e) => onDraftChange((prev) => ({ ...prev, notes: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.825rem',
                    background: '#ffffff',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {formError && (
                <div
                  style={{
                    background: '#fff1f2',
                    border: '1px solid #fda4af',
                    color: '#9f1239',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                  }}
                >
                  {formError}
                </div>
              )}
            </form>
          ) : (
            <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>
              {isEgypt
                ? 'لا تملك صلاحية تجهيز كشوف المرتبات.'
                : 'لا تملك صلاحية تجهيز مسيرات الرواتب.'}
            </p>
          )}
        </div>

        {/* Standard Modal Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'center',
            gap: '10px',
            padding: '14px 20px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
          }}
        >
          {hasCreatePayrollRun && canManagePayroll ? (
            <Button
              type="submit"
              form="create-payroll-form"
              disabled={isPending}
              style={{
                backgroundColor: '#170e5e',
                color: '#ffffff',
                fontWeight: 700,
                padding: '8px 20px',
                borderRadius: '8px',
              }}
            >
              {isPending
                ? t('hr.payroll.create_payroll_run_modal.pending', 'جارٍ احتساب الرواتب...')
                : payrollAction}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              fontWeight: 600,
            }}
          >
            {t('hr.payroll.create_payroll_run_modal.cancel', 'إلغاء')}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
