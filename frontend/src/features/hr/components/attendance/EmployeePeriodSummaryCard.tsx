import React from 'react';
import type { HrAttendanceRecord } from '@/types/domain';
import { calculateAttendancePayableMinutes } from './attendance-types';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

interface EmployeePeriodSummaryCardProps {
  employee?: {
    id: string;
    employeeNo?: string;
    displayName?: string;
    departmentName?: string;
    jobTitleName?: string;
    compensationType?: string;
    hourlyRate?: number;
    expectedDailyHours?: number;
    overtimePolicy?: string;
    scheduledCheckInTime?: string;
    scheduledCheckOutTime?: string;
    graceMinutes?: number;
  } | null;
  from: string;
  to: string;
  summary?: {
    totalItems: number;
    workedMinutes: number;
    payableMinutes: number;
    presentCount: number;
    absentCount: number;
    lateCount: number;
  };
  rows: HrAttendanceRecord[];
}

export const EmployeePeriodSummaryCard: React.FC<EmployeePeriodSummaryCardProps> = ({
  employee,
  from,
  to,
  summary,
  rows,
}) => {
  // Aggregate stats from rows if summary not fully populated
  const totalWorkedMinutes = summary?.workedMinutes ?? rows.reduce((acc, row) => {
    if (!row.checkInAt || !row.checkOutAt || ['absent', 'leave'].includes(row.status || '')) return acc;
    const [ih, im] = (row.checkInAt.slice(11, 16) || row.checkInAt).split(':').map(Number);
    const [oh, om] = (row.checkOutAt.slice(11, 16) || row.checkOutAt).split(':').map(Number);
    if (![ih, im, oh, om].every(Number.isFinite)) return acc;
    const start = ih * 60 + im, end = oh * 60 + om;
    const mins = end <= start ? end + 1440 - start : end - start;
    return acc + (mins > 0 && mins <= 1440 ? mins : 0);
  }, 0);

  const totalPayableMinutes = summary?.payableMinutes ?? rows.reduce((acc, row) => {
    if (row.compensationType !== 'hourly' || !row.checkInAt || !row.checkOutAt || ['absent', 'leave'].includes(row.status || '')) return acc;
    const [ih, im] = (row.checkInAt.slice(11, 16) || row.checkInAt).split(':').map(Number);
    const [oh, om] = (row.checkOutAt.slice(11, 16) || row.checkOutAt).split(':').map(Number);
    if (![ih, im, oh, om].every(Number.isFinite)) return acc;
    const start = ih * 60 + im, end = oh * 60 + om;
    const mins = end <= start ? end + 1440 - start : end - start;
    if (mins <= 0 || mins > 1440) return acc;
    const { payableMinutes: pMins } = calculateAttendancePayableMinutes({
      ...row,
      expectedDailyHours: employee?.expectedDailyHours ?? row.expectedDailyHours,
      overtimePolicy: employee?.overtimePolicy ?? row.overtimePolicy,
      actualMinutes: mins,
    });
    return acc + pMins;
  }, 0);

  const presentDays = summary?.presentCount ?? rows.filter((r) => r.status === 'present').length;
  const absentDays = summary?.absentCount ?? rows.filter((r) => r.status === 'absent').length;
  const lateDays = summary?.lateCount ?? rows.filter((r) => r.status === 'late').length;

  const totalHours = (totalWorkedMinutes / 60).toFixed(2);
  const hoursInt = Math.floor(totalWorkedMinutes / 60);
  const minsInt = Math.round(totalWorkedMinutes % 60);

  const payableHours = (totalPayableMinutes / 60).toFixed(2);
  const hourlyRate = Number(employee?.hourlyRate || rows[0]?.hourlyRate || 0);
  // INV-FE3-FRONTEND-BOOK-DIGITS: estimated pay is money; it rounds at
  // the tenant's book digits, not hardcoded 2dp. (payableHours/totalHours
  // above are hours, not money — they stay at 2dp.)
  const bookDigits = currencyMoneyDigits(getGlobalSystemCurrency());
  const estimatedPay = hourlyRate > 0 ? roundMoneyValue(Number(payableHours) * hourlyRate, bookDigits).toFixed(bookDigits) : null;

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #cbd5e1',
        borderRadius: '12px',
        padding: '16px 20px',
        marginBottom: '16px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      {/* Header Info */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: '12px',
          marginBottom: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: '#170e5e',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '1rem',
              flexShrink: 0,
            }}
          >
            {employee?.displayName ? employee.displayName.charAt(0) : 'م'}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                {employee?.displayName || 'ملخص فترة الحضور الشامل'}
              </span>
              {employee?.employeeNo && (
                <span
                  style={{
                    background: '#e0e7ff',
                    color: '#170e5e',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                  }}
                >
                  كود: {employee.employeeNo}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px', display: 'flex', gap: '8px' }}>
              {employee?.departmentName && <span>القسم: {employee.departmentName}</span>}
              {employee?.jobTitleName && <span>· الوظيفة: {employee.jobTitleName}</span>}
              {employee?.scheduledCheckInTime && (
                <span>
                  · الوردية المقررة: {employee.scheduledCheckInTime} - {employee.scheduledCheckOutTime || '17:00'}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '4px 12px',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: '#334155',
            }}
          >
            الفترة: من {from} إلى {to}
          </span>
          <span
            style={{
              background: '#eef2ff',
              color: '#170e5e',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '0.8rem',
              fontWeight: 700,
            }}
          >
            {rows.length} يوم مسجل
          </span>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
        }}
      >
        {/* Total Worked Hours */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 14px',
            borderRight: '4px solid #170e5e',
          }}
        >
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block' }}>
            إجمالي ساعات التشغيل الفعلية
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '4px' }}>
            <span style={{ fontSize: '1.45rem', fontWeight: 800, color: '#170e5e' }}>{totalHours}</span>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>ساعة</span>
          </div>
          <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px', display: 'block' }}>
            ما يعادل {hoursInt} س و {minsInt} دقيقة
          </span>
        </div>

        {/* Days breakdown */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 14px',
            borderRight: '4px solid #16a34a',
          }}
        >
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block' }}>
            سجل الأيام والالتزام
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '4px' }}>
            <span style={{ fontSize: '1.45rem', fontWeight: 800, color: '#16a34a' }}>{presentDays}</span>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>أيام حضور</span>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px', display: 'flex', gap: '8px' }}>
            {absentDays > 0 ? (
              <span style={{ color: '#dc2626', fontWeight: 700 }}>{absentDays} غياب</span>
            ) : (
              <span>0 غياب</span>
            )}
            {lateDays > 0 && <span style={{ color: '#d97706', fontWeight: 700 }}>· {lateDays} تأخير</span>}
          </div>
        </div>

        {/* Paid Hours / Compensation */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 14px',
            borderRight: '4px solid #0284c7',
          }}
        >
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block' }}>
            ساعات واستحقاق الأجر
          </span>
          {employee?.compensationType === 'hourly' || rows[0]?.compensationType === 'hourly' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '4px' }}>
                <span style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0284c7' }}>{payableHours}</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>ساعة معتمدة</span>
              </div>
              <span style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 700, marginTop: '2px', display: 'block' }}>
                {estimatedPay ? `الاستحقاق التقديري: ${estimatedPay} ج.م (${hourlyRate} ج.م/ساعة)` : 'أجر بالساعة'}
              </span>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '4px' }}>
                <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>راتب شهري ثابت</span>
              </div>
              <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                الاستحقاق يدخل ضمن كشف المرتبات الشهري
              </span>
            </>
          )}
        </div>

        {/* Average Daily Work Hours */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 14px',
            borderRight: '4px solid #8b5cf6',
          }}
        >
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block' }}>
            متوسط ساعات العمل اليومية
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '4px' }}>
            <span style={{ fontSize: '1.45rem', fontWeight: 800, color: '#8b5cf6' }}>
              {presentDays > 0 ? (totalWorkedMinutes / 60 / presentDays).toFixed(1) : '0.0'}
            </span>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>ساعة / يوم</span>
          </div>
          <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px', display: 'block' }}>
            معدل التشغيل في أيام الحضور الفعلية
          </span>
        </div>
      </div>
    </div>
  );
};
