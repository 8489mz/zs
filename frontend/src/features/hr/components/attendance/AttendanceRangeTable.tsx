import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import type { HrAttendanceRecord } from '@/types/domain';
import { calculateAttendancePayableMinutes } from './attendance-types';

const STATUS_LABELS: Record<string, { label: string; bg: string; color: string; border: string }> = {
  present: { label: 'حاضر', bg: '#dcfce7', color: '#166534', border: '#bbf7d0' },
  absent: { label: 'غائب', bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
  late: { label: 'متأخر', bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
  early_leave: { label: 'انصراف مبكر', bg: '#fef9c3', color: '#854d0e', border: '#fef08a' },
  leave: { label: 'إجازة', bg: '#dbeafe', color: '#1e40af', border: '#bfdbfe' },
  half_day: { label: 'نصف يوم', bg: '#f3e8ff', color: '#6b21a8', border: '#e9d5ff' },
  excused: { label: 'بعذر', bg: '#f1f5f9', color: '#334155', border: '#cbd5e1' },
};

export function AttendanceRangeTable({ rows }: { rows: HrAttendanceRecord[] }) {
  const navigate = useNavigate();

  // INV-ATTENDANCE-EQUAL-TIMES-ZERO: equal check-in/check-out times mean zero
  // worked minutes. The midnight wrap applies only when end < start (a real
  // night shift); with `<=` an instant "now/now" pair wrapped to a full 1440
  // minutes (24 h). Time-only values cannot express a true 24 h span, and
  // the backend pay engine (real timestamps) is unaffected.
  const getRowTimes = (row: HrAttendanceRecord): { start: number; end: number } | null => {
    if (!row.checkInAt || !row.checkOutAt || ['absent', 'leave'].includes(row.status || '')) return null;
    const [ih, im] = (row.checkInAt.slice(11, 16) || row.checkInAt).split(':').map(Number);
    const [oh, om] = (row.checkOutAt.slice(11, 16) || row.checkOutAt).split(':').map(Number);
    if (![ih, im, oh, om].every(Number.isFinite)) return null;
    return { start: ih * 60 + im, end: oh * 60 + om };
  };

  const getRowMinutes = (row: HrAttendanceRecord): number => {
    const times = getRowTimes(row);
    if (!times) return 0;
    const minutes = times.end < times.start ? times.end + 1440 - times.start : times.end - times.start;
    return minutes > 0 && minutes <= 1440 ? minutes : 0;
  };

  const duration = (row: HrAttendanceRecord) => {
    if (!row.checkInAt || !row.checkOutAt) return '—';
    const minutes = getRowMinutes(row);
    if (minutes > 0) return `${Math.floor(minutes / 60)} س ${minutes % 60} د`;
    // Both times are present and valid but equal: a real zero-hour day,
    // not a missing record.
    if (getRowTimes(row)) return '0 س 0 د';
    return '—';
  };

  const totals = useMemo(() => {
    let totalMinutes = 0;
    let payableMinutes = 0;
    let presentCount = 0;
    let absentCount = 0;
    let lateCount = 0;

    for (const row of rows) {
      const mins = getRowMinutes(row);
      totalMinutes += mins;
      if (row.compensationType === 'hourly') {
        const { payableMinutes: pMins } = calculateAttendancePayableMinutes({
          ...row,
          actualMinutes: mins,
        });
        payableMinutes += pMins;
      }
      if (row.status === 'present') presentCount += 1;
      else if (row.status === 'absent') absentCount += 1;
      else if (row.status === 'late') lateCount += 1;
    }

    return {
      totalHours: (totalMinutes / 60).toFixed(2),
      hoursInt: Math.floor(totalMinutes / 60),
      minsInt: Math.round(totalMinutes % 60),
      payableHours: (payableMinutes / 60).toFixed(2),
      hasHourly: payableMinutes > 0,
      presentCount,
      absentCount,
      lateCount,
    };
  }, [rows]);


  return (
    <div className="attendance-table-container">
      <DataTable<HrAttendanceRecord>
        rows={rows}
        rowKey={(row) => `${row.employeeId}-${row.workDate}-${row.id || ''}`}
        density="compact"
        columns={[
          {
            key: 'employee',
            header: 'الموظف',
            className: 'col-main',
            cell: (row) => (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigate(`/hr/employees/${row.employeeId}`)}
                  style={{
                    padding: '2px 8px',
                    fontSize: '0.825rem',
                    fontWeight: 700,
                    textAlign: 'center',
                    justifyContent: 'center',
                    color: '#170e5e',
                  }}
                >
                  {row.employeeName || row.employeeNo || 'موظف'}
                </Button>
                {row.jobTitleName && (
                  <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '1px', textAlign: 'center' }}>
                    {row.jobTitleName}
                  </span>
                )}
              </div>
            ),
          },
          {
            key: 'department',
            header: 'القسم',
            className: 'col-fit',
            cell: (row) => row.departmentName || '—',
          },
          {
            key: 'date',
            header: 'التاريخ',
            className: 'col-fit',
            cell: (row) => (
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0f172a' }}>
                {row.workDate}
              </span>
            ),
          },
          {
            key: 'day',
            header: 'اليوم',
            className: 'col-fit',
            cell: (row) => {
              try {
                return (
                  <span style={{ color: '#475569', fontWeight: 600 }}>
                    {new Intl.DateTimeFormat('ar-EG', { weekday: 'long' }).format(new Date(row.workDate + 'T12:00:00'))}
                  </span>
                );
              } catch {
                return '—';
              }
            },
          },
          {
            key: 'shift',
            header: 'الوردية المقررة',
            className: 'col-fit',
            cell: (row) =>
              row.scheduledCheckInTime || row.scheduledCheckOutTime ? (
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  {row.scheduledCheckInTime || '09:00'} - {row.scheduledCheckOutTime || '17:00'}
                </span>
              ) : (
                '—'
              ),
          },
          {
            key: 'in',
            header: 'وقت الحضور',
            className: 'col-fit',
            cell: (row) => (
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: row.checkInAt ? '#0f172a' : '#94a3b8' }}>
                {row.checkInAt?.slice(11, 16) || '—'}
              </span>
            ),
          },
          {
            key: 'out',
            header: 'وقت الانصراف',
            className: 'col-fit',
            cell: (row) => (
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: row.checkOutAt ? '#0f172a' : '#94a3b8' }}>
                {row.checkOutAt?.slice(11, 16) || '—'}
              </span>
            ),
          },
          {
            key: 'hours',
            header: 'ساعات التشغيل',
            className: 'col-fit',
            cell: (row) => {
              const dur = duration(row);
              return dur !== '—' ? (
                <span style={{ fontWeight: 700, color: '#0f172a' }}>
                  {dur}
                </span>
              ) : (
                '—'
              );
            },
          },
          {
            key: 'payableHours',
            header: 'ساعات الأجر',
            className: 'col-fit',
            cell: (row) => {
              if (row.compensationType !== 'hourly') {
                return <span style={{ fontSize: '0.75rem', color: '#64748b' }}>راتب شهري</span>;
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
                  <span style={{ fontWeight: 700, color: '#0369a1' }}>
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
            header: 'الحالة',
            className: 'col-fit',
            cell: (row) => {
              const s = STATUS_LABELS[row.status || ''];
              if (s) {
                return (
                  <span
                    style={{
                      background: s.bg,
                      color: s.color,
                      border: `1px solid ${s.border}`,
                      borderRadius: '5px',
                      padding: '2px 8px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      display: 'inline-block',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.label}
                  </span>
                );
              }
              return row.status || '—';
            },
          },
          {
            key: 'notes',
            header: 'ملاحظات',
            className: 'col-main',
            cell: (row) =>
              row.notes ? (
                <span style={{ fontSize: '0.8rem', color: '#475569' }} title={row.notes}>
                  {row.notes}
                </span>
              ) : (
                '—'
              ),
          },
        ]}
      />

      {/* Comprehensive Total Footer Row */}
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
              إجمالي السجلات بالفترة:
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
              {rows.length} يوم عمل
            </span>
            <span style={{ fontSize: '0.78rem', color: '#64748b', marginRight: '6px' }}>
              ({totals.presentCount} حضور · {totals.absentCount} غياب · {totals.lateCount} تأخير)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.825rem', fontWeight: 600, color: '#475569' }}>
                مجموع ساعات التشغيل الفعلية:
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
                {totals.totalHours} ساعة ({totals.hoursInt} س و {totals.minsInt} د)
              </span>
            </div>

            {totals.hasHourly && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.825rem', fontWeight: 600, color: '#475569' }}>
                  ساعات الأجر المستحقة:
                </span>
                <span
                  style={{
                    background: '#0284c7',
                    color: '#ffffff',
                    padding: '3px 10px',
                    borderRadius: '5px',
                    fontSize: '0.9rem',
                    fontWeight: 800,
                  }}
                >
                  {totals.payableHours} ساعة
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
