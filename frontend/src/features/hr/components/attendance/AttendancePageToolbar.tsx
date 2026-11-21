import React from 'react';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  type ExceptionFilter,
  normalizeArabicDigits,
  todayDate,
} from './attendance-types';

export type AttendancePeriodMode = 'day' | 'week' | 'last_week' | 'month' | 'last_month' | 'custom';

interface AttendancePageToolbarProps {
  viewMode: AttendancePeriodMode;
  selectPeriod: (mode: AttendancePeriodMode) => void;
  stepDay: (delta: number) => void;
  date: string;
  setDate: (val: string) => void;
  rangeFrom: string;
  setRangeFrom: (val: string) => void;
  rangeTo: string;
  setRangeTo: (val: string) => void;
  setViewMode: (mode: AttendancePeriodMode) => void;
  setRangePage: (page: number) => void;
  selectedEmployeeId: string;
  setSelectedEmployeeId: (id: string) => void;
  activeEmployees: any[];
  selectedDepartmentId: string;
  setSelectedDepartmentId: (id: string) => void;
  departments: any[];
  activeTab: 'attendance' | 'exceptions';
  setActiveTab: (tab: 'attendance' | 'exceptions') => void;
  summary: {
    needsAction: number;
    unmarked: number;
    present: number;
    absent: number;
    late: number;
  };
  isRange: boolean;
  handleMarkAllPresentByShift: () => void;
  handleSaveAllChanges: () => void;
  isSavingBatch: boolean;
  dirtyRowsCount: number;
  handleExportCsv: () => void;
  exceptionMonth: string;
  setExceptionMonth: (month: string) => void;
  exceptionFilter: ExceptionFilter;
  setExceptionFilter: (filter: ExceptionFilter) => void;
  attendanceFilter: 'all' | 'unmarked' | 'recorded';
  setAttendanceFilter: (filter: 'all' | 'unmarked' | 'recorded') => void;
  totalRowsCount: number;
}

export function AttendancePageToolbar({
  viewMode,
  selectPeriod,
  stepDay,
  date,
  setDate,
  rangeFrom,
  setRangeFrom,
  rangeTo,
  setRangeTo,
  setViewMode,
  setRangePage,
  selectedEmployeeId,
  setSelectedEmployeeId,
  activeEmployees,
  selectedDepartmentId,
  setSelectedDepartmentId,
  departments,
  activeTab,
  setActiveTab,
  summary,
  isRange,
  handleMarkAllPresentByShift,
  handleSaveAllChanges,
  isSavingBatch,
  dirtyRowsCount,
  handleExportCsv,
  exceptionMonth,
  setExceptionMonth,
  exceptionFilter,
  setExceptionFilter,
  attendanceFilter,
  setAttendanceFilter,
  totalRowsCount,
}: AttendancePageToolbarProps) {
  return (
    <>
      <div
        className="no-print"
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          padding: '12px 14px',
          marginBottom: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {/* Row 1: Periods & Dates */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            <Button
              type="button"
              variant={viewMode === 'day' ? 'primary' : 'secondary'}
              onClick={() => selectPeriod('day')}
              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
            >
              اليوم
            </Button>
            <Button
              type="button"
              variant={viewMode === 'week' ? 'primary' : 'secondary'}
              onClick={() => selectPeriod('week')}
              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
            >
              الأسبوع الحالي
            </Button>
            <Button
              type="button"
              variant={viewMode === 'last_week' ? 'primary' : 'secondary'}
              onClick={() => selectPeriod('last_week')}
              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
            >
              الأسبوع الماضي
            </Button>
            <Button
              type="button"
              variant={viewMode === 'month' ? 'primary' : 'secondary'}
              onClick={() => selectPeriod('month')}
              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
            >
              الشهر الحالي
            </Button>
            <Button
              type="button"
              variant={viewMode === 'last_month' ? 'primary' : 'secondary'}
              onClick={() => selectPeriod('last_month')}
              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
            >
              الشهر الماضي
            </Button>
            <Button
              type="button"
              variant={viewMode === 'custom' ? 'primary' : 'secondary'}
              onClick={() => selectPeriod('custom')}
              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
            >
              فترة مخصصة
            </Button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {viewMode === 'day' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <button
                  type="button"
                  onClick={() => stepDay(-1)}
                  title="اليوم السابق"
                  style={{
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '5px',
                    padding: '4px 8px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  › السابق
                </button>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    const v = normalizeArabicDigits(e.target.value || todayDate());
                    setDate(v);
                    setRangeFrom(v);
                    setRangeTo(v);
                  }}
                  style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem', background: '#fff' }}
                />
                <button
                  type="button"
                  onClick={() => stepDay(1)}
                  title="اليوم التالي"
                  style={{
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '5px',
                    padding: '4px 8px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  التالي ‹
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>من:</span>
                  <input
                    type="date"
                    value={rangeFrom}
                    max={rangeTo}
                    onChange={(e) => {
                      setRangeFrom(e.target.value);
                      setViewMode('custom');
                      setRangePage(1);
                    }}
                    style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem', background: '#fff' }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>إلى:</span>
                  <input
                    type="date"
                    value={rangeTo}
                    min={rangeFrom}
                    onChange={(e) => {
                      setRangeTo(e.target.value);
                      setViewMode('custom');
                      setRangePage(1);
                    }}
                    style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem', background: '#fff' }}
                  />
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => selectPeriod('day')}
              style={{
                background: '#e0e7ff',
                border: 'none',
                color: '#170e5e',
                fontSize: '0.75rem',
                fontWeight: 700,
                borderRadius: '4px',
                padding: '4px 8px',
                cursor: 'pointer',
              }}
              title="العودة لليوم الحالي"
            >
              اليوم
            </button>
          </div>
        </div>

        {/* Row 2: Selectors & Actions */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            borderTop: '1px solid #e2e8f0',
            paddingTop: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <div style={{ width: '235px' }}>
              <CustomSelect
                value={selectedEmployeeId}
                onChange={(val) => {
                  setSelectedEmployeeId(val);
                  setRangePage(1);
                }}
                options={[
                  { value: '', label: 'جميع الموظفين النشطين' },
                  ...activeEmployees.map((emp) => ({
                    value: emp.id,
                    label: emp.displayName || emp.firstName || 'موظف',
                    hint: emp.employeeNo ? `#${emp.employeeNo}` : '',
                    code: String(emp.employeeNo || emp.id || ''),
                  })),
                ]}
                placeholder="ابحث أو اختر الموظف..."
              />
            </div>

            <div style={{ width: '140px' }}>
              <CustomSelect
                value={selectedDepartmentId}
                onChange={(val) => {
                  setSelectedDepartmentId(val);
                  setRangePage(1);
                }}
                options={[
                  { value: '', label: 'كافة الأقسام' },
                  ...departments.map((d) => ({ value: d.id, label: d.name })),
                ]}
                placeholder="كافة الأقسام"
              />
            </div>

            <div style={{ display: 'flex', gap: '2px', background: '#e2e8f0', padding: '2px', borderRadius: '6px' }}>
              <button
                type="button"
                onClick={() => setActiveTab('attendance')}
                style={{
                  border: 'none',
                  background: activeTab === 'attendance' ? '#ffffff' : 'transparent',
                  color: activeTab === 'attendance' ? '#170e5e' : '#64748b',
                  fontWeight: 600,
                  padding: '4px 8px',
                  borderRadius: '5px',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  boxShadow: activeTab === 'attendance' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                سجل الحضور
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('exceptions')}
                style={{
                  border: 'none',
                  background: activeTab === 'exceptions' ? '#ffffff' : 'transparent',
                  color: activeTab === 'exceptions' ? '#170e5e' : '#64748b',
                  fontWeight: 600,
                  padding: '4px 8px',
                  borderRadius: '5px',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  boxShadow: activeTab === 'exceptions' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>استثناءات الشهر</span>
                {summary.needsAction > 0 && (
                  <span style={{ background: '#dc2626', color: '#ffffff', borderRadius: '10px', padding: '0 5px', fontSize: '0.68rem', fontWeight: 800 }}>
                    {summary.needsAction}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {activeTab === 'attendance' && !isRange && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleMarkAllPresentByShift}
                  style={{ padding: '4px 8px', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                  title="تسجيل حضور الموظفين غير المسجلين بالوردية المحددة لهم"
                >
                  تسجيل حضور الكل بالوردية
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveAllChanges}
                  disabled={isSavingBatch || dirtyRowsCount === 0}
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    background: dirtyRowsCount > 0 ? '#170e5e' : '#f1f5f9',
                    color: dirtyRowsCount > 0 ? '#ffffff' : '#94a3b8',
                    border: dirtyRowsCount > 0 ? 'none' : '1px solid #cbd5e1',
                    cursor: dirtyRowsCount > 0 ? 'pointer' : 'default',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isSavingBatch ? 'جاري الحفظ...' : `حفظ كافة التعديلات (${dirtyRowsCount})`}
                </Button>
              </>
            )}

            <Button
              type="button"
              variant="secondary"
              onClick={handleExportCsv}
              style={{ padding: '4px 8px', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
            >
              تصدير إكسيل
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.print()}
              style={{ padding: '4px 8px', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
            >
              طباعة الكشف
            </Button>
          </div>
        </div>
      </div>

      {/* Exceptions Toolbar */}
      {activeTab === 'exceptions' && (
        <div
          className="no-print"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            background: '#f8fafc',
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            marginBottom: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>الشهر:</span>
            <input
              type="month"
              value={exceptionMonth}
              onChange={(e) => setExceptionMonth(normalizeArabicDigits(e.target.value || todayDate().slice(0, 7)))}
              style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem', background: '#fff' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <Button type="button" variant={exceptionFilter === 'needs_action' ? 'primary' : 'secondary'} onClick={() => setExceptionFilter('needs_action')} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>يحتاج إجراء</Button>
            <Button type="button" variant={exceptionFilter === 'overtime' ? 'primary' : 'secondary'} onClick={() => setExceptionFilter('overtime')} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>إضافي</Button>
            <Button type="button" variant={exceptionFilter === 'deduction' ? 'primary' : 'secondary'} onClick={() => setExceptionFilter('deduction')} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>خصم</Button>
            <Button type="button" variant={exceptionFilter === 'all' ? 'primary' : 'secondary'} onClick={() => setExceptionFilter('all')} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>الكل</Button>
          </div>
        </div>
      )}

      {/* Daily Status Filter Pills */}
      {activeTab === 'attendance' && !isRange && (
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>تصفية الحالة:</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <Button type="button" variant={attendanceFilter === 'all' ? 'primary' : 'secondary'} onClick={() => setAttendanceFilter('all')} style={{ padding: '3px 10px', fontSize: '0.78rem' }}>الكل ({totalRowsCount})</Button>
            <Button type="button" variant={attendanceFilter === 'unmarked' ? 'primary' : 'secondary'} onClick={() => setAttendanceFilter('unmarked')} style={{ padding: '3px 10px', fontSize: '0.78rem' }}>لم يسجل ({summary.unmarked})</Button>
            <Button type="button" variant={attendanceFilter === 'recorded' ? 'primary' : 'secondary'} onClick={() => setAttendanceFilter('recorded')} style={{ padding: '3px 10px', fontSize: '0.78rem' }}>مسجل ({summary.present + summary.absent + summary.late})</Button>
          </div>
        </div>
      )}
    </>
  );
}
