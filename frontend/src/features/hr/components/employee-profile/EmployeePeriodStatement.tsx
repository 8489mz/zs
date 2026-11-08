import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useHrAttendance } from '@/features/hr/hooks/useHr';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';
import { hrApi } from '@/features/hr/api/hr.api';
import { DataTable } from '@/shared/ui/data-table';
import type { HrEmployee, HrWithdrawalRow } from '@/types/domain';
import { todayDate } from '@/features/hr/components/attendance/attendance-types';

type Props = { employeeId: string; employee: HrEmployee; canViewLoans: boolean; canViewSalary: boolean };
const egyptMoney = (amount: number) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(amount);

function attendanceStatusBadge(status?: string) {
  const s = String(status || '').toLowerCase().trim();
  if (s === 'present') return <span style={{ padding: '2px 8px', borderRadius: 4, background: '#dcfce7', color: '#15803d', fontWeight: 700, fontSize: '0.75rem' }}>حاضر</span>;
  if (s === 'absent') return <span style={{ padding: '2px 8px', borderRadius: 4, background: '#fee2e2', color: '#b91c1c', fontWeight: 700, fontSize: '0.75rem' }}>غائب</span>;
  if (s === 'late') return <span style={{ padding: '2px 8px', borderRadius: 4, background: '#fef3c7', color: '#b45309', fontWeight: 700, fontSize: '0.75rem' }}>متأخر</span>;
  if (s === 'excused') return <span style={{ padding: '2px 8px', borderRadius: 4, background: '#e0e7ff', color: '#3730a3', fontWeight: 700, fontSize: '0.75rem' }}>إذن رسمي</span>;
  if (s === 'half_day') return <span style={{ padding: '2px 8px', borderRadius: 4, background: '#ffedd5', color: '#c2410c', fontWeight: 700, fontSize: '0.75rem' }}>نصف يوم</span>;
  if (s === 'early_leave') return <span style={{ padding: '2px 8px', borderRadius: 4, background: '#fef3c7', color: '#b45309', fontWeight: 700, fontSize: '0.75rem' }}>انصراف مبكر</span>;
  if (s === 'leave') return <span style={{ padding: '2px 8px', borderRadius: 4, background: '#e0f2fe', color: '#0369a1', fontWeight: 700, fontSize: '0.75rem' }}>إجازة</span>;
  return <span style={{ padding: '2px 8px', borderRadius: 4, background: '#f1f5f9', color: '#475569', fontWeight: 600, fontSize: '0.75rem' }}>{status || '—'}</span>;
}

function formatLedgerNote(note?: string, type?: string): string {
  if (!note || !note.trim()) {
    return type === 'loan' ? 'صرف السلفة للموظف' : 'سداد دفعة من السلفة';
  }
  const text = note.trim();
  const lower = text.toLowerCase();
  if (lower.includes('employee loan repayment') || lower.includes('loan repayment')) return 'سداد دفعة من السلفة';
  if (lower.includes('employee advance/loan disbursed') || lower.includes('loan disbursement') || lower.includes('loan disbursed')) return 'صرف السلفة للموظف';
  if (lower.includes('payroll salary deduction') || lower.includes('salary deduction')) return 'استقطاع من مسير الرواتب';
  return text;
}

export function EmployeePeriodStatement({ employeeId, employee, canViewLoans, canViewSalary }: Props) {
  const navigate = useNavigate();
  const [from, setFrom] = useState(todayDate().slice(0, 7) + '-01');
  const [to, setTo] = useState(todayDate());
  const [attendancePage, setAttendancePage] = useState(1);
  const [withdrawalPage, setWithdrawalPage] = useState(1);
  const days = Math.floor((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
  const validRange = Boolean(from && to && days >= 0 && days <= 92);
  const canViewAttendance = useHasAnyPermission('hrAttendance');
  const attendance = useHrAttendance({ employeeId, from, to, page: attendancePage, pageSize: 100 }, { enabled: validRange && canViewAttendance });
  const withdrawals = useQuery({
    queryKey: ['hr', 'period-statement-withdrawals', employeeId, from, to, withdrawalPage],
    queryFn: () => hrApi.withdrawals({ employeeId, period: 'custom', from, to, page: withdrawalPage, pageSize: 100 }),
    enabled: canViewLoans && validRange,
  });
  const minutes = Number(attendance.data?.summary?.workedMinutes || 0);
  const completedHours = (minutes / 60).toFixed(2);
  const payableHours = (Number(attendance.data?.summary?.payableMinutes || 0) / 60).toFixed(2);
  const hourly = employee.compensationType === 'hourly';
  const rate = Number(employee.hourlyRate || 0);
  // INV-FE3-FRONTEND-BOOK-DIGITS: indicative pay is money; it rounds at
  // the tenant's book digits, not hardcoded 2dp. (payableHours above is
  // hours, not money — it stays at 2dp.)
  const indicativePay = roundMoneyValue(Number(payableHours) * rate, currencyMoneyDigits(getGlobalSystemCurrency()));
  const rows = withdrawals.data?.rows || [];

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px', marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
      {/* Title & Date Range Filter Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16, borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>
        <div>
          <strong style={{ fontSize: '1rem', color: '#0f172a', display: 'block' }}>سجل تشغيل ومستحقات الموظف للفترة</strong>
          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>متابعة تفصيلية لساعات العمل، الحضور والانصراف، وحركات السلف والمسحوبات</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => navigate(`/hr/attendance?employeeId=${employeeId}`)}
            style={{
              padding: '6px 12px',
              fontSize: '0.78rem',
              borderRadius: 6,
              border: '1px solid #170e5e',
              backgroundColor: '#170e5e',
              color: '#ffffff',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            فتح سجل البصمات الكامل
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f8fafc', padding: '4px 10px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
              من: <input type="date" value={from} onChange={e => { setFrom(e.target.value); setAttendancePage(1); setWithdrawalPage(1); }} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.8rem' }} />
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
              إلى: <input type="date" value={to} onChange={e => { setTo(e.target.value); setAttendancePage(1); setWithdrawalPage(1); }} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.8rem' }} />
            </label>
          </div>
        </div>
      </div>

      {!validRange ? <p className="error-box">الفترة يجب أن تكون صحيحة ولا تزيد عن 93 يومًا.</p> : null}
      {attendance.isError && canViewAttendance ? <p className="error-box">تعذر تحميل سجلات الحضور.</p> : null}
      {!canViewAttendance ? <p className="muted">ليس لديك صلاحية عرض الحضور والانصراف.</p> : null}

      {/* Metric Cards Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, display: 'block' }}>إجمالي ساعات العمل</span>
          <strong style={{ fontSize: '1.15rem', color: '#0f172a', marginTop: 2, display: 'block' }}>{attendance.isLoading ? '—' : `${completedHours} س`}</strong>
        </div>

        {hourly ? (
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
            <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, display: 'block' }}>ساعات الأجر المستحقة</span>
            <strong style={{ fontSize: '1.15rem', color: '#0f172a', marginTop: 2, display: 'block' }}>{attendance.isLoading ? '—' : `${payableHours} س`}</strong>
          </div>
        ) : null}

        {hourly && canViewSalary ? (
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
            <span style={{ fontSize: '0.75rem', color: '#166534', fontWeight: 600, display: 'block' }}>الأجر المستحق للفترة</span>
            <strong style={{ fontSize: '1.15rem', color: '#15803d', marginTop: 2, display: 'block' }}>{attendance.isLoading ? '—' : `${egyptMoney(indicativePay)} ج.م`}</strong>
          </div>
        ) : null}

        {canViewLoans ? (
          <>
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #fed7aa', borderRadius: 8, padding: '10px 14px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              <span style={{ fontSize: '0.75rem', color: '#9a3412', fontWeight: 600, display: 'block' }}>المسحوبات خلال الفترة</span>
              <strong style={{ fontSize: '1.15rem', color: '#c2410c', marginTop: 2, display: 'block' }}>{withdrawals.isLoading ? '—' : `${egyptMoney(Number(withdrawals.data?.summary?.totalWithdrawals || 0))} ج.م`}</strong>
            </div>
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              <span style={{ fontSize: '0.75rem', color: '#991b1b', fontWeight: 600, display: 'block' }}>مديونية السلف الحالية</span>
              <strong style={{ fontSize: '1.15rem', color: '#dc2626', marginTop: 2, display: 'block' }}>{withdrawals.isLoading ? '—' : `${egyptMoney(Number(withdrawals.data?.summary?.totalRemaining || 0))} ج.م`}</strong>
            </div>
          </>
        ) : null}
      </div>

      {hourly ? (
        <div style={{ marginBottom: 14, fontSize: '0.78rem', color: '#64748b', background: '#f8fafc', padding: '6px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
          الأجر المعروض استرشادي للموظف بنظام أجر الساعة، وصافي الصرف النهائي يتم اعتماده في مسير الرواتب بعد الاستقطاعات والتسويات.
        </div>
      ) : null}

      {/* Section 1: Attendance Table */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: '0.92rem', color: '#0f172a' }}>سجل الحضور والانصراف</strong>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{attendance.data?.rows?.length || 0} يوم مسجل</span>
        </div>
        <DataTable
          rows={attendance.data?.rows || []}
          rowKey={row => String(row.id || row.workDate)}
          density="compact"
          columns={[
            { key: 'date', header: 'التاريخ', cell: row => <span style={{ fontWeight: 600 }}>{row.workDate}</span> },
            { key: 'in', header: 'الحضور', cell: row => row.checkInAt?.slice(11, 16) || '—' },
            { key: 'out', header: 'الانصراف', cell: row => row.checkOutAt?.slice(11, 16) || '—' },
            { key: 'duration', header: 'مدة العمل', cell: row => {
              if (!row.checkInAt || !row.checkOutAt) return '—';
              const start = new Date(row.checkInAt).getTime();
              const end = new Date(row.checkOutAt).getTime();
              const diffMins = Math.round((end - start) / 60000);
              if (diffMins <= 0) return '—';
              const hours = Math.floor(diffMins / 60);
              const mins = diffMins % 60;
              return <span style={{ fontWeight: 600, color: '#0f172a' }}>{hours} س {mins > 0 ? `${mins} د` : ''}</span>;
            }},
            { key: 'state', header: 'الحالة', cell: row => attendanceStatusBadge(row.status) },
            { key: 'notes', header: 'ملاحظات / المصدر', cell: row => row.notes || (row.source ? (row.source === 'device' ? 'جهاز البصمة' : row.source === 'mobile' ? 'تطبيق الموبايل' : 'يدوي') : '—') },
          ]}
        />
        {canViewAttendance && Number(attendance.data?.pagination?.totalPages || 1) > 1 ? (
          <div className="actions compact-actions" style={{ marginTop: 8 }}>
            <button type="button" disabled={attendancePage <= 1} onClick={() => setAttendancePage(n => Math.max(1, n - 1))}>السابق</button>
            <span>صفحة {attendancePage} من {attendance.data?.pagination?.totalPages}</span>
            <button type="button" disabled={attendancePage >= Number(attendance.data?.pagination?.totalPages || 1)} onClick={() => setAttendancePage(n => n + 1)}>التالي</button>
          </div>
        ) : null}
      </div>

      {/* Section 2: Withdrawals Table */}
      {canViewLoans ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: '0.92rem', color: '#0f172a' }}>المسحوبات وحركات السداد</strong>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{rows.length} حركة</span>
          </div>
          {withdrawals.isError ? <p className="error-box">تعذر تحميل المسحوبات.</p> : null}
          <DataTable<HrWithdrawalRow>
            rows={rows}
            rowKey={row => row.id}
            density="compact"
            columns={[
              { key: 'date', header: 'التاريخ والوقت', cell: row => <span style={{ fontWeight: 600 }}>{row.movementAt || '—'}</span> },
              { key: 'type', header: 'الحركة', cell: row => (
                <span style={{
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  backgroundColor: row.type === 'repayment' ? '#f0fdf4' : '#eff6ff',
                  color: row.type === 'repayment' ? '#15803d' : '#1d4ed8'
                }}>
                  {row.type === 'repayment' ? 'سداد سلفة' : row.type === 'loan' ? 'صرف سلفة' : 'مسحوب / سلفة'}
                </span>
              ) },
              { key: 'amount', header: 'القيمة', cell: row => (
                <strong style={{ color: row.type === 'repayment' ? '#15803d' : '#0f172a' }}>
                  {egyptMoney(Number(row.amount || 0))} ج.م
                </strong>
              ) },
              { key: 'note', header: 'تفاصيل الحركة والبيان', cell: row => formatLedgerNote(row.note, row.type) },
              { key: 'actor', header: 'سجّل الحركة', cell: row => <span style={{ fontWeight: 600, color: '#1e293b' }}>{row.recordedByName || '—'}</span> },
            ]}
          />
          {Number(withdrawals.data?.pagination?.totalPages || 1) > 1 ? (
            <div className="actions compact-actions" style={{ marginTop: 8 }}>
              <button type="button" disabled={withdrawalPage <= 1} onClick={() => setWithdrawalPage(n => Math.max(1, n - 1))}>السابق</button>
              <span>صفحة {withdrawalPage} من {withdrawals.data?.pagination?.totalPages}</span>
              <button type="button" disabled={withdrawalPage >= Number(withdrawals.data?.pagination?.totalPages || 1)} onClick={() => setWithdrawalPage(n => n + 1)}>التالي</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
