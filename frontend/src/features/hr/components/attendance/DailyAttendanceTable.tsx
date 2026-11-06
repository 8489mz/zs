import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { DataTable } from '@/shared/ui/data-table';
import { CustomSelect } from '@/shared/ui/custom-select';
import type { HrAttendanceRecord } from '@/types/domain';
import { DraftRow, calculateAttendancePayableMinutes } from './attendance-types';
import { TimeAmPmInput } from './TimeAmPmInput';



interface DailyAttendanceTableProps {
  rows: HrAttendanceRecord[];
  draftByEmployeeId: Record<string, DraftRow>;
  modifiedEmployeeIds?: Set<string>;
  onUpdateDraft: (employeeId: string, patch: Partial<DraftRow>) => void;
  onSaveRow: (employeeId: string) => void;
}

export const DailyAttendanceTable: React.FC<DailyAttendanceTableProps> = ({
  rows,
  draftByEmployeeId,
  modifiedEmployeeIds,
  onUpdateDraft,
  onSaveRow,
}) => {
  const { t } = useTranslation();

  // INV-ATTENDANCE-EQUAL-TIMES-ZERO: equal check-in/check-out times mean zero
  // worked minutes. The midnight wrap applies only when end < start (a real
  // night shift); with `<=` an instant "now/now" pair wrapped to a full 1440
  // minutes (24 h). Time-only values cannot express a true 24 h span, and
  // the backend pay engine (real timestamps) is unaffected.
  const getRowTimes = (row: HrAttendanceRecord): { start: number; end: number } | null => {
    const draft = draftByEmployeeId[String(row.employeeId)];
    const status = String(draft?.status || row.status || '');
    if (!status || ['absent', 'leave'].includes(status)) return null;

    const checkIn = draft?.checkInAt || row.checkInAt?.slice(11, 16) || '';
    const checkOut = draft?.checkOutAt || row.checkOutAt?.slice(11, 16) || '';
    if (!checkIn || !checkOut) return null;
    const [ih, im] = checkIn.split(':').map(Number);
    const [oh, om] = checkOut.split(':').map(Number);
    if (![ih, im, oh, om].every(Number.isFinite)) return null;
    return { start: ih * 60 + im, end: oh * 60 + om };
  };

  const getRowMinutes = (row: HrAttendanceRecord): number => {
    const times = getRowTimes(row);
    if (!times) return 0;
    const minutes = times.end < times.start ? times.end + 1440 - times.start : times.end - times.start;
    return minutes > 0 && minutes <= 1440 ? minutes : 0;
  };

  const workedHours = (row: HrAttendanceRecord) => {
    const minutes = getRowMinutes(row);
    if (minutes > 0) return `${Math.floor(minutes / 60)} س ${minutes % 60} د`;
    // Both times are present and valid but equal: a real zero-hour day,
    // not a missing record.
    if (getRowTimes(row)) return '0 س 0 د';
    return '—';
  };

  const setNowTime = (employeeId: string, field: 'checkInAt' | 'checkOutAt') => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const current = draftByEmployeeId[employeeId];
    onUpdateDraft(employeeId, {
      [field]: `${hh}:${mm}`,
      status: current?.status || 'present',
    });
  };

  const summary = useMemo(() => {
    let totalMins = 0;
    let presentCount = 0;
    let absentCount = 0;
    let lateCount = 0;
    let unmarkedCount = 0;

    for (const row of rows) {
      const draft = draftByEmployeeId[String(row.employeeId)];
      const st = String(draft?.status || row.status || '');
      if (st === 'present') presentCount += 1;
      else if (st === 'absent') absentCount += 1;
      else if (st === 'late') lateCount += 1;
      else unmarkedCount += 1;

      totalMins += getRowMinutes(row);
    }

    return {
      totalHours: (totalMins / 60).toFixed(2),
      hoursInt: Math.floor(totalMins / 60),
      minsInt: Math.round(totalMins % 60),
      presentCount,
      absentCount,
      lateCount,
      unmarkedCount,
    };
  }, [rows, draftByEmployeeId]);

  return (
    <div className="attendance-table-container">
      <DataTable
        rows={rows}
        rowKey={(row) => String(row.employeeId)}
        density="compact"
        columns={[
          {
            key: 'employeeNo',
            header: t('hr.attendance.daily_attendance_table.s0', "الكود"),
            className: 'col-fit',
            cell: (row) => (
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#475569', fontSize: '0.8rem' }}>
                {row.employeeNo || '—'}
              </span>
            ),
          },
          {
            key: 'employeeName',
            header: t('hr.attendance.daily_attendance_table.s1', "اسم الموظف"),
            className: 'col-main',
            cell: (row) => (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.825rem' }}>
                  {row.employeeName || '—'}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '0.7rem', color: '#64748b', marginTop: '1px', flexWrap: 'wrap', textAlign: 'center' }}>
                  {row.jobTitleName && <span>{row.jobTitleName}</span>}
                  {(row.scheduledCheckInTime || row.scheduledCheckOutTime) ? (
                    <span
                      style={{
                        background: '#f1f5f9',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        border: '1px solid #e2e8f0',
                        color: '#334155',
                        fontWeight: 600,
                        fontSize: '0.68rem',
                      }}
                    >
                      {row.scheduledCheckInTime || '09:00'} - {row.scheduledCheckOutTime || '17:00'}
                      {row.graceMinutes ? ` (${row.graceMinutes}د)` : ''}
                    </span>
                  ) : null}
                </div>
              </div>
            ),
          },
          {
            key: 'departmentName',
            header: t('hr.attendance.daily_attendance_table.s2', "القسم"),
            className: 'col-fit',
            cell: (row) => <span style={{ fontSize: '0.78rem' }}>{row.departmentName || '—'}</span>,
          },
          {
            key: 'checkInAt',
            header: t('hr.attendance.daily_attendance_table.s3', "وقت الحضور"),
            className: 'col-fit',
            cell: (row) => {
              const currentStatus = draftByEmployeeId[String(row.employeeId)]?.status || row.status || '';
              if (currentStatus === 'leave') {
                return (
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '4px', padding: '2px 6px' }}>
                    إجازة
                  </span>
                );
              }
              if (currentStatus === 'absent') {
                return (
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px', padding: '2px 6px' }}>
                    غائب
                  </span>
                );
              }

              const schedIn = row.scheduledCheckInTime || '09:00';
              const schedInHour = Number(schedIn.split(':')[0]) || 9;
              const defaultPeriodIn: 'AM' | 'PM' = schedInHour >= 12 ? 'PM' : 'AM';
              const valIn = draftByEmployeeId[String(row.employeeId)]?.checkInAt || '';

              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', justifyContent: 'center' }}>
                  <TimeAmPmInput
                    value={valIn}
                    defaultPeriod={defaultPeriodIn}
                    onChange={(newVal) => onUpdateDraft(String(row.employeeId), { checkInAt: newVal })}
                  />
                  <button
                    type="button"
                    title="وضع الوقت الحالي"
                    onClick={() => setNowTime(String(row.employeeId), 'checkInAt')}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '4px',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      color: '#170e5e',
                      padding: '2px 4px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    الآن
                  </button>
                </div>
              );
            },
          },
          {
            key: 'checkOutAt',
            header: t('hr.attendance.daily_attendance_table.s4', "وقت الانصراف"),
            className: 'col-fit',
            cell: (row) => {
              const currentStatus = draftByEmployeeId[String(row.employeeId)]?.status || row.status || '';
              if (currentStatus === 'leave' || currentStatus === 'absent') {
                return <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>معفي</span>;
              }

              const schedOut = row.scheduledCheckOutTime || '17:00';
              const schedOutHour = Number(schedOut.split(':')[0]) || 17;
              const defaultPeriodOut: 'AM' | 'PM' = schedOutHour >= 12 ? 'PM' : 'AM';
              const valOut = draftByEmployeeId[String(row.employeeId)]?.checkOutAt || '';

              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', justifyContent: 'center' }}>
                  <TimeAmPmInput
                    value={valOut}
                    defaultPeriod={defaultPeriodOut}
                    onChange={(newVal) => onUpdateDraft(String(row.employeeId), { checkOutAt: newVal })}
                  />
                  <button
                    type="button"
                    title="وضع الوقت الحالي"
                    onClick={() => setNowTime(String(row.employeeId), 'checkOutAt')}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '4px',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      color: '#170e5e',
                      padding: '2px 4px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    الآن
                  </button>
                </div>
              );
            },
          },
          {
            key: 'duration',
            header: 'ساعات العمل',
            className: 'col-fit',
            cell: (row) => {
              const dur = workedHours(row);
              return dur !== '—' ? (
                <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.8rem' }}>
                  {dur}
                </span>
              ) : (
                '—'
              );
            },
          },
          {
            key: 'paidHours',
            header: 'ساعات الأجر',
            className: 'col-fit',
            cell: (row) => {
              if (row.compensationType !== 'hourly') {
                return <span style={{ fontSize: '0.72rem', color: '#64748b' }}>راتب شهري</span>;
              }
              const mins = getRowMinutes(row);
              if (mins <= 0) return '—';
              const { payableMinutes, approvedOvertimeMinutes, pendingOvertimeMinutes, isCapped } = calculateAttendancePayableMinutes({
                ...row,
                actualMinutes: mins,
              });
              const pH = Math.floor(payableMinutes / 60);
              const pM = payableMinutes % 60;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                  <span style={{ fontWeight: 700, color: '#0369a1', fontSize: '0.8rem' }}>
                    {pH} س {pM > 0 ? `${pM} د` : '0 د'}
                  </span>
                  {approvedOvertimeMinutes > 0 && (
                    <span style={{ fontSize: '0.68rem', color: '#16a34a', fontWeight: 600 }}>
                      (منها {Math.floor(approvedOvertimeMinutes / 60)}س {approvedOvertimeMinutes % 60}د إضافي معتمد)
                    </span>
                  )}
                  {isCapped && pendingOvertimeMinutes > 0 && approvedOvertimeMinutes === 0 && (
                    <span
                      title="ساعات عمل زائدة عن الوردية بانتظار اعتماد المدير من تبويب الاستثناءات"
                      style={{
                        fontSize: '0.68rem',
                        color: '#d97706',
                        background: '#fef3c7',
                        border: '1px solid #fde68a',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      +{Math.floor(pendingOvertimeMinutes / 60)}س بانتظار الاعتماد
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            key: 'status',
            header: t('hr.attendance.daily_attendance_table.s5', "الحالة"),
            className: 'col-fit',
            cell: (row) => {
              const currentStatus = draftByEmployeeId[String(row.employeeId)]?.status || '';
              return (
                <div style={{ width: '108px' }}>
                  <CustomSelect
                    value={currentStatus}
                    onChange={(val) => onUpdateDraft(String(row.employeeId), { status: val })}
                    style={{ background: '#ffffff', border: '1px solid #cbd5e1', fontSize: '0.78rem' }}
                    options={[
                      {
                        value: '',
                        label: t('hr.attendance.daily_attendance_table.s6', "غير مسجل"),
                        icon: <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#94a3b8', display: 'inline-block' }} />,
                      },
                      {
                        value: 'present',
                        label: t('hr.attendance.daily_attendance_table.s7', "حاضر"),
                        icon: <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />,
                      },
                      {
                        value: 'absent',
                        label: t('hr.attendance.daily_attendance_table.s8', "غائب"),
                        icon: <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} />,
                      },
                      {
                        value: 'late',
                        label: t('hr.attendance.daily_attendance_table.s9', "متأخر"),
                        icon: <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#d97706', display: 'inline-block' }} />,
                      },
                      {
                        value: 'early_leave',
                        label: t('hr.attendance.daily_attendance_table.s10', "انصراف مبكر"),
                        icon: <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ea580c', display: 'inline-block' }} />,
                      },
                      {
                        value: 'leave',
                        label: t('hr.attendance.daily_attendance_table.s11', "إجازة"),
                        icon: <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2563eb', display: 'inline-block' }} />,
                      },
                      {
                        value: 'half_day',
                        label: t('hr.attendance.daily_attendance_table.s12', "نصف يوم"),
                        icon: <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#7c3aed', display: 'inline-block' }} />,
                      },
                      {
                        value: 'excused',
                        label: t('hr.attendance.daily_attendance_table.s13', "بعذر"),
                        icon: <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#475569', display: 'inline-block' }} />,
                      },
                    ]}
                  />
                </div>
              );
            },
          },
          {
            key: 'notes',
            header: t('hr.attendance.daily_attendance_table.s14', "ملاحظات"),
            className: 'col-main',
            cell: (row) => (
              <input
                value={draftByEmployeeId[String(row.employeeId)]?.notes || ''}
                onChange={(e) => onUpdateDraft(String(row.employeeId), { notes: e.target.value })}
                placeholder={t('hr.attendance.daily_attendance_table.s15', "ملاحظات...")}
                style={{
                  padding: '3px 6px',
                  fontSize: '0.78rem',
                  width: '100%',
                  minWidth: '50px',
                  borderRadius: '5px',
                  border: '1px solid #cbd5e1',
                  boxSizing: 'border-box',
                }}
              />
            ),
          },
          {
            key: 'actions',
            header: t('hr.attendance.daily_attendance_table.s16', "إجراء"),
            className: 'col-fit',
            cell: (row) => {
              const dirty = modifiedEmployeeIds ? modifiedEmployeeIds.has(String(row.employeeId)) : false;
              return (
                <button
                  type="button"
                  onClick={() => dirty && onSaveRow(String(row.employeeId))}
                  disabled={!dirty}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    borderRadius: '5px',
                    border: dirty ? 'none' : '1px solid #e2e8f0',
                    background: dirty ? '#170e5e' : '#f8fafc',
                    color: dirty ? '#ffffff' : '#94a3b8',
                    cursor: dirty ? 'pointer' : 'default',
                    boxShadow: dirty ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    whiteSpace: 'nowrap',
                  }}
                  title={dirty ? 'حفظ تعديلات هذا الموظف' : 'تم حفظ السجل مسبقاً'}
                >
                  {dirty && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#38bdf8' }} />}
                  {dirty ? 'حفظ' : 'محفوظ'}
                </button>
              );
            },
          },
        ]}
      />

      {/* Daily Summary Footer */}
      {rows.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '12px 18px',
            marginTop: '12px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.825rem', fontWeight: 800, color: '#0f172a' }}>
              إجمالي موظفي اليوم:
            </span>
            <span
              style={{
                background: '#e2e8f0',
                color: '#1e293b',
                padding: '2px 8px',
                borderRadius: '5px',
                fontSize: '0.8rem',
                fontWeight: 800,
              }}
            >
              {rows.length} موظف
            </span>
            <span style={{ fontSize: '0.78rem', color: '#64748b', marginRight: '6px' }}>
              ({summary.presentCount} حاضر · {summary.absentCount} غائب · {summary.lateCount} متأخر · {summary.unmarkedCount} غير مسجل)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.825rem', fontWeight: 600, color: '#475569' }}>
              مجموع ساعات التشغيل الفعلية اليوم:
            </span>
            <span
              style={{
                background: '#170e5e',
                color: '#ffffff',
                padding: '3px 10px',
                borderRadius: '5px',
                fontSize: '0.9rem',
                fontWeight: 800,
              }}
            >
              {summary.totalHours} ساعة ({summary.hoursInt} س و {summary.minsInt} د)
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
