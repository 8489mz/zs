import { useTranslation } from 'react-i18next';
import React from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { ClockIcon, UserIcon, CalendarIcon } from '@/shared/components/icons/AppIcons';
import { useServerClock } from '@/shared/hooks/use-server-clock';
import { TimeAmPmInput } from './TimeAmPmInput';
import type { ManualAttendancePrompt } from './attendance-types';

interface ManualAttendanceModalProps {
  prompt: ManualAttendancePrompt;
  timeInput: string;
  setTimeInput: (val: string) => void;
  noteInput?: string;
  setNoteInput?: (val: string) => void;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (e?: React.FormEvent) => void;
  /** Server instant (ISO) from the page's attendance list response. */
  serverTime?: string;
  /** Tenant zone from the page's attendance list response. */
  serverTimezone?: string;
}

export const ManualAttendanceModal: React.FC<ManualAttendanceModalProps> = ({
  prompt,
  timeInput,
  setTimeInput,
  noteInput,
  setNoteInput,
  isPending,
  onClose,
  onSubmit,
  serverTime,
  serverTimezone,
}) => {
  const { t } = useTranslation();
  const serverClock = useServerClock(serverTime, serverTimezone);
  if (!prompt) return null;

  const isCheckIn = prompt.type === 'check_in';
  const actionLabel = isCheckIn
    ? t('hr.attendance.manual_attendance_modal.s_check_in', "حضور")
    : t('hr.attendance.manual_attendance_modal.s_check_out', "انصراف");

  const title = `${t('hr.attendance.manual_attendance_modal.s0', "تسجيل")} ${actionLabel} ${t('hr.attendance.manual_attendance_modal.s3', "يدوي")}`;
  const subtitle = t(
    'hr.attendance.manual_attendance_modal.s_subtitle',
    "معالجة البصمة المعلقة وتوثيق التوقيت الفعلي في سجلات الدوام الرسمية"
  );

  const handleSetCurrentTime = () => {
    // P8 (RC-7): the "current time" comes from the server clock in the
    // tenant zone, never the client clock.
    setTimeInput(serverClock.timeHHmm());
  };

  const handleSetScheduledTime = () => {
    const fallback = isCheckIn ? '09:00' : '17:00';
    setTimeInput(prompt.scheduledTime || prompt.defaultTime || fallback);
  };

  return (
    <StandardDialog
      open={Boolean(prompt)}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      width="min(480px, 95vw)"
      footerActions={(
        <StandardDialogFooter
          onCancel={onClose}
          onSubmit={onSubmit}
          isSubmitting={isPending}
          submitText={`${t('hr.attendance.manual_attendance_modal.s6', "تسجيل")} ${actionLabel}`}
          cancelText={t('hr.attendance.manual_attendance_modal.s5', "إلغاء")}
        />
      )}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(e);
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingTop: '4px' }}
      >
        {/* Context Summary Card */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: '#eef2ff',
                  border: '1px solid #c7d2fe',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <UserIcon size={18} color="#170e5e" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
                  {prompt.employeeName || `الموظف رقم #${prompt.employeeId}`}
                </span>
                <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                  كود الموظف: {prompt.employeeNo || prompt.employeeId}
                </span>
              </div>
            </div>

            <span
              style={{
                background: '#fef3c7',
                color: '#b45309',
                border: '1px solid #fde68a',
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: '6px',
              }}
            >
              بصمة معلقة
            </span>
          </div>

          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              padding: '6px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.76rem',
              color: '#334155',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <CalendarIcon size={13} color="#64748b" />
              تاريخ العمل: <strong>{prompt.workDate}</strong>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <ClockIcon size={13} color="#64748b" />
              المجدول: <strong>{prompt.scheduledTime || '—'}</strong>
            </span>
          </div>
        </div>

        {/* Time Input Section */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ClockIcon size={14} color="#170e5e" />
              {t('hr.attendance.manual_attendance_modal.s4', "أدخل الوقت")} ({actionLabel} الفعلي)
              <span style={{ color: '#dc2626' }}>*</span>
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 0' }}>
            <TimeAmPmInput
              value={timeInput}
              onChange={setTimeInput}
              defaultPeriod={isCheckIn ? 'AM' : 'PM'}
            />
          </div>

          {/* Quick Presets */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', paddingTop: '2px' }}>
            <button
              type="button"
              onClick={handleSetScheduledTime}
              style={{
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '0.72rem',
                fontWeight: 600,
                color: '#170e5e',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <ClockIcon size={12} color="#170e5e" />
              الموعد المجدول ({prompt.scheduledTime || (isCheckIn ? '09:00' : '17:00')})
            </button>

            <button
              type="button"
              onClick={handleSetCurrentTime}
              style={{
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '0.72rem',
                fontWeight: 600,
                color: '#475569',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <ClockIcon size={12} color="#64748b" />
              توقيت الآن
            </button>
          </div>
        </div>

        {/* Optional Administrative Note */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>
            ملاحظات إدارية / سبب التعديل اليدوي (اختياري)
          </label>
          <textarea
            value={noteInput || ''}
            onChange={(e) => setNoteInput?.(e.target.value)}
            placeholder="مثال: الموظف تواجد وانصرف في الموعد المحدد ونسي تسجيل البصمة..."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              minHeight: '52px',
              maxHeight: '90px',
              padding: '8px 10px',
              fontSize: '0.8rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              outline: 'none',
              resize: 'vertical',
              lineHeight: 1.45,
            }}
          />
        </div>
      </form>
    </StandardDialog>
  );
};
