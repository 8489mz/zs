import { useTranslation } from 'react-i18next';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/shared/components/page-header';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/components/system-alert';
import type { HrAttendanceException, HrAttendanceRecord } from '@/types/domain';
import { useHrAttendance, useHrAttendanceExceptions, useHrMutations } from '@/features/hr/hooks/useHr';
import { hrApi } from '@/features/hr/api/hr.api';
import { queryKeys } from '@/app/query-keys';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';
import {
  DraftRow,
  ExceptionFilter,
  ManualAttendancePrompt,
  todayDate,
  normalizeArabicDigits,
  normalizeTime,
  toDateTime,
  toCheckOutDateTime,
  isOvertimeException,
  isDeductionException,
  isActionableException,
  filterExceptions,
} from '../components/attendance/attendance-types';
import { AttendanceKpiSummary } from '../components/attendance/AttendanceKpiSummary';
import { serverDayKey } from '@/shared/hooks/use-server-clock';
import { AttendanceExceptionsTable } from '../components/attendance/AttendanceExceptionsTable';
import { DailyAttendanceTable } from '../components/attendance/DailyAttendanceTable';
import { AttendanceRangeTable } from '../components/attendance/AttendanceRangeTable';
import { EmployeePeriodSummaryCard } from '../components/attendance/EmployeePeriodSummaryCard';
import { ManualAttendanceModal } from '../components/attendance/ManualAttendanceModal';
import { BiometricIntegrationModal } from '../components/attendance/BiometricIntegrationModal';
import { AttendancePageToolbar } from '../components/attendance/AttendancePageToolbar';

type PeriodMode = 'day' | 'week' | 'last_week' | 'month' | 'last_month' | 'custom';

function getLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// P8 (RC-7): the "today" bound is the server day in the tenant zone,
// passed in by the page once the attendance list resolves. The client
// clock is only the pre-data fallback (todayDate()).
function calculatePeriodRange(mode: PeriodMode, refDateStr: string, todayStr: string = todayDate()): { from: string; to: string } {
  if (mode === 'day') {
    return { from: refDateStr || todayStr, to: refDateStr || todayStr };
  }

  if (mode === 'week') {
    // Current week: Saturday to today
    const d = new Date((refDateStr || todayStr) + 'T12:00:00');
    const day = d.getDay(); // 0: Sun, 1: Mon, ..., 6: Sat
    const diff = (day + 1) % 7; // days since Saturday: Sat(6)->0, Sun(0)->1, ...
    const sat = new Date(d);
    sat.setDate(sat.getDate() - diff);
    return { from: getLocalDateString(sat), to: todayStr };
  }

  if (mode === 'last_week') {
    // Last week: Saturday to Friday of previous week
    const d = new Date((refDateStr || todayStr) + 'T12:00:00');
    const day = d.getDay();
    const diff = (day + 1) % 7;
    const curSat = new Date(d);
    curSat.setDate(curSat.getDate() - diff);

    const prevSat = new Date(curSat);
    prevSat.setDate(prevSat.getDate() - 7);

    const prevFri = new Date(prevSat);
    prevFri.setDate(prevFri.getDate() + 6);
    return { from: getLocalDateString(prevSat), to: getLocalDateString(prevFri) };
  }

  if (mode === 'month') {
    // Current month to date: 1st of month to today
    return { from: `${todayStr.slice(0, 7)}-01`, to: todayStr };
  }

  if (mode === 'last_month') {
    // Last month: 1st to last day of last month
    const [y, m] = todayStr.split('-').map(Number);
    const lastDayLastMonth = new Date(y, m - 1, 0);
    const ly = lastDayLastMonth.getFullYear();
    const lm = String(lastDayLastMonth.getMonth() + 1).padStart(2, '0');
    const d = String(lastDayLastMonth.getDate()).padStart(2, '0');
    return { from: `${ly}-${lm}-01`, to: `${ly}-${lm}-${d}` };
  }

  return { from: refDateStr || todayStr, to: todayStr };
}

export function HrAttendancePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlEmployeeId = searchParams.get('employeeId') || '';
  const urlPeriod = searchParams.get('period') || '';

  const initialPeriod = useMemo(() => {
    if (urlPeriod && /^\d{4}-\d{2}$/.test(urlPeriod)) {
      const [y, m] = urlPeriod.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      return {
        from: `${urlPeriod}-01`,
        to: `${urlPeriod}-${String(lastDay).padStart(2, '0')}`,
        viewMode: 'month' as PeriodMode,
      };
    }
    return {
      from: todayDate(),
      to: todayDate(),
      viewMode: 'day' as PeriodMode,
    };
  }, [urlPeriod]);

  const mutations = useHrMutations();

  // Period and date states
  const [date, setDate] = useState(todayDate());
  const [viewMode, setViewMode] = useState<PeriodMode>(initialPeriod.viewMode);
  const [rangeFrom, setRangeFrom] = useState(initialPeriod.from);
  const [rangeTo, setRangeTo] = useState(initialPeriod.to);
  const [rangePage, setRangePage] = useState(1);

  // Filter states
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(urlEmployeeId);

  // Sync URL search parameters if navigated dynamically
  useEffect(() => {
    const empId = searchParams.get('employeeId');
    if (empId) {
      setSelectedEmployeeId(empId);
      const period = searchParams.get('period');
      if (period && /^\d{4}-\d{2}$/.test(period)) {
        const [y, m] = period.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        setRangeFrom(`${period}-01`);
        setRangeTo(`${period}-${String(lastDay).padStart(2, '0')}`);
        setViewMode('month');
        setRangePage(1);
      }
    }
  }, [searchParams]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('');
  const [search, _setSearch] = useState('');
  const [attendanceFilter, setAttendanceFilter] = useState<'all' | 'unmarked' | 'recorded'>('all');

  // Exceptions and drafts
  const [exceptionMonth, setExceptionMonth] = useState(todayDate().slice(0, 7));
  const [exceptionFilter, setExceptionFilter] = useState<ExceptionFilter>('needs_action');
  const [draftByEmployeeId, setDraftByEmployeeId] = useState<Record<string, DraftRow>>({});
  const [modifiedEmployeeIds, setModifiedEmployeeIds] = useState<Set<string>>(new Set());
  const [biometricModalOpen, setBiometricModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'attendance' | 'exceptions'>('attendance');
  const [manualPrompt, setManualPrompt] = useState<ManualAttendancePrompt>(null);
  const [manualTimeInput, setManualTimeInput] = useState('');
  const [manualNoteInput, setManualNoteInput] = useState('');

  // Active employees for combobox
  const canFetchEmployees = useHasAnyPermission(['hrEmployees', 'hrAttendance']);
  const canViewEmployees = useHasAnyPermission(['hrEmployees']);
  const canViewPayroll = useHasAnyPermission(['hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove']);
  const employeesQuery = useQuery({
    queryKey: ['hr', 'attendance-active-employees'],
    queryFn: () => hrApi.employees({ status: 'active', pageSize: 500 }),
    enabled: canFetchEmployees,
  });
  const activeEmployees = useMemo(() => employeesQuery.data?.employees || [], [employeesQuery.data?.employees]);

  // Departments for dropdown
  const departmentsQuery = useQuery({
    queryKey: queryKeys.hrMasterData('departments'),
    queryFn: () => hrApi.masterData('departments'),
  });
  const departments = useMemo(() => (departmentsQuery.data?.rows || []) as { id: string; name: string }[], [departmentsQuery.data?.rows]);

  const isRange = viewMode !== 'day' || (rangeFrom !== rangeTo && Boolean(rangeFrom && rangeTo));

  const selectPeriod = (mode: PeriodMode) => {
    setViewMode(mode);
    setRangePage(1);
    const { from, to } = calculatePeriodRange(mode, date, serverToday);
    setRangeFrom(from);
    setRangeTo(to);
    if (mode === 'day') {
      setDate(from);
    }
  };

  const stepDay = (delta: number) => {
    const current = new Date(date + 'T12:00:00');
    current.setDate(current.getDate() + delta);
    const nextDateStr = getLocalDateString(current);
    setDate(nextDateStr);
    setRangeFrom(nextDateStr);
    setRangeTo(nextDateStr);
    setViewMode('day');
  };

  const rangeDays = Math.floor((Date.parse(rangeTo + 'T00:00:00Z') - Date.parse(rangeFrom + 'T00:00:00Z')) / 86400000);
  const validRange = !isRange || (Boolean(rangeFrom && rangeTo) && rangeDays >= 0 && rangeDays <= 93);

  const attendance = useHrAttendance(
    isRange
      ? {
          from: rangeFrom,
          to: rangeTo,
          employeeId: selectedEmployeeId || undefined,
          departmentId: selectedDepartmentId || undefined,
          search,
          page: rangePage,
          pageSize: 200,
        }
      : {
          date,
          employeeId: selectedEmployeeId || undefined,
          departmentId: selectedDepartmentId || undefined,
          search,
          page: 1,
          pageSize: 200,
        },
    { enabled: validRange }
  );

  const exceptions = useHrAttendanceExceptions({
    month: exceptionMonth,
    employeeId: selectedEmployeeId || undefined,
    departmentId: selectedDepartmentId || undefined,
    search,
    page: 1,
    pageSize: 200,
  });
  const rows = useMemo(() => (attendance.data?.rows || []) as HrAttendanceRecord[], [attendance.data?.rows]);

  // P8 (RC-7): the page opens on the SERVER's tenant day, not the client
  // clock's day. Adopt it once, when the attendance list first resolves,
  // and only while the page still shows the client-today value — a
  // user-picked date (or a ?period= URL month) is never overridden.
  const serverToday = useMemo(() => {
    return serverDayKey(attendance.data?.serverTime, attendance.data?.serverTimezone) || todayDate();
  }, [attendance.data?.serverTime, attendance.data?.serverTimezone]);
  const adoptedServerDayRef = useRef(false);
  useEffect(() => {
    if (!attendance.data?.serverTime || adoptedServerDayRef.current) return;
    adoptedServerDayRef.current = true;
    const clientToday = todayDate();
    if (date === clientToday && serverToday !== clientToday) {
      setDate(serverToday);
      if (viewMode === 'day') {
        setRangeFrom(serverToday);
        setRangeTo(serverToday);
      }
    }
    if (exceptionMonth === clientToday.slice(0, 7) && serverToday.slice(0, 7) !== clientToday.slice(0, 7)) {
      setExceptionMonth(serverToday.slice(0, 7));
    }
  }, [attendance.data?.serverTime, date, viewMode, exceptionMonth, serverToday]);
  const allExceptionRows = useMemo(() => (exceptions.data?.rows || []) as HrAttendanceException[], [exceptions.data?.rows]);
  
  const scopedExceptionRows = useMemo(() => {
    let list = allExceptionRows;
    if (selectedEmployeeId) {
      list = list.filter((r) => String(r.employeeId) === String(selectedEmployeeId));
    }
    if (selectedDepartmentId) {
      list = list.filter((r) => String((r as any).departmentId) === String(selectedDepartmentId));
    }
    return list;
  }, [allExceptionRows, selectedEmployeeId, selectedDepartmentId]);

  const exceptionRows = useMemo(() => filterExceptions(scopedExceptionRows, exceptionFilter), [scopedExceptionRows, exceptionFilter]);

  const selectedEmployee = useMemo(() => {
    if (!selectedEmployeeId) return null;
    return activeEmployees.find((e) => String(e.id) === String(selectedEmployeeId)) || null;
  }, [activeEmployees, selectedEmployeeId]);

  const filteredAttendanceRows = useMemo(() => {
    let result = rows;
    if (selectedEmployeeId) {
      result = result.filter((row) => String(row.employeeId) === String(selectedEmployeeId));
    }
    if (selectedDepartmentId) {
      result = result.filter((row) => String(row.departmentId) === String(selectedDepartmentId));
    }
    if (search) {
      const q = search.trim().toLowerCase();
      result = result.filter((row) =>
        [row.employeeNo, row.employeeName, row.departmentName, row.jobTitleName]
          .filter(Boolean)
          .some((val) => String(val).toLowerCase().includes(q))
      );
    }
    if (isRange) return result;
    return result.filter((row) => {
      const status = String(draftByEmployeeId[String(row.employeeId)]?.status || row.status || '');
      if (attendanceFilter === 'unmarked') return !status;
      if (attendanceFilter === 'recorded') return Boolean(status);
      return true;
    });
  }, [rows, selectedEmployeeId, selectedDepartmentId, search, draftByEmployeeId, attendanceFilter, isRange]);

  useEffect(() => {
    const next: Record<string, DraftRow> = {};
    if (isRange) return;
    for (const row of rows) {
      const employeeId = String(row.employeeId || '');
      if (!employeeId) continue;
      next[employeeId] = {
        employeeId,
        status: String(row.status || ''),
        checkInAt: normalizeTime(String(row.checkInAt || '').slice(11, 16) || String(row.checkInAt || '')),
        checkOutAt: normalizeTime(String(row.checkOutAt || '').slice(11, 16) || String(row.checkOutAt || '')),
        notes: String(row.notes || ''),
      };
    }
    setDraftByEmployeeId(next);
    setModifiedEmployeeIds(new Set());
  }, [rows, isRange]);

  const summary = useMemo(() => {
    let present = 0;
    let absent = 0;
    let late = 0;
    let unmarked = 0;
    for (const row of rows) {
      const status = String(draftByEmployeeId[String(row.employeeId)]?.status || row.status || '').toLowerCase();
      if (!status) unmarked += 1;
      else if (status === 'present') present += 1;
      else if (status === 'absent') absent += 1;
      else if (status === 'late') late += 1;
    }
    const needsAction = scopedExceptionRows.filter(isActionableException).length;
    const overtime = scopedExceptionRows.filter((row) => isOvertimeException(row.exceptionType)).length;
    const deduction = scopedExceptionRows.filter((row) => isDeductionException(row.exceptionType)).length;
    const data = attendance.data?.summary;
    return {
      total: isRange ? Number(data?.totalItems || 0) : rows.length,
      present: isRange ? Number(data?.presentCount || 0) : present,
      absent: isRange ? Number(data?.absentCount || 0) : absent,
      late: isRange ? Number(data?.lateCount || 0) : late,
      unmarked: isRange ? 0 : unmarked,
      needsAction,
      overtime,
      deduction,
    };
  }, [rows, draftByEmployeeId, scopedExceptionRows, isRange, attendance.data?.summary]);

  const updateDraft = (employeeId: string, patch: Partial<DraftRow>) => {
    setDraftByEmployeeId((current) => {
      const existing = current[employeeId] || { employeeId, status: '', checkInAt: '', checkOutAt: '', notes: '' };
      const nextDraft = { ...existing, ...patch };
      if (!nextDraft.status && (patch.checkInAt || patch.checkOutAt)) {
        nextDraft.status = 'present';
      }
      return { ...current, [employeeId]: nextDraft };
    });
    setModifiedEmployeeIds((prev) => new Set(prev).add(employeeId));
  };

  const saveRow = async (employeeId: string, patch?: Partial<DraftRow>) => {
    const current = draftByEmployeeId[employeeId] || { employeeId, status: '', checkInAt: '', checkOutAt: '', notes: '' };
    const draft = patch ? { ...current, ...patch } : current;
    if (!draft.status && (draft.checkInAt || draft.checkOutAt)) draft.status = 'present';

    if (patch) {
      setDraftByEmployeeId((prev) => ({ ...prev, [employeeId]: draft }));
    }

    if (draft.status || draft.checkInAt || draft.checkOutAt) {
      const payloadRow = {
        employeeId: Number(normalizeArabicDigits(draft.employeeId)),
        workDate: date,
        status: draft.status || 'present',
        checkInAt: toDateTime(date, draft.checkInAt),
        checkOutAt: toCheckOutDateTime(date, draft.checkInAt, draft.checkOutAt),
        notes: draft.notes || undefined,
        source: 'manual',
      };
      await mutations.saveAttendanceDay.mutateAsync({ workDate: date, rows: [payloadRow] })
        .then(() => {
          setModifiedEmployeeIds((prev) => {
            const next = new Set(prev);
            next.delete(employeeId);
            return next;
          });
          toast.success('تم حفظ سجل الموظف بنجاح');
        })
        .catch(() => toast.error('تعذر حفظ السجل'));
    }
  };

  const dirtyRows = useMemo(() => {
    if (isRange) return [];
    return rows
      .filter((row) => modifiedEmployeeIds.has(String(row.employeeId)))
      .map((row) => {
        const draft = draftByEmployeeId[String(row.employeeId)];
        return {
          employeeId: Number(normalizeArabicDigits(draft?.employeeId || row.employeeId)),
          workDate: date,
          status: draft?.status || 'present',
          checkInAt: toDateTime(date, draft?.checkInAt),
          checkOutAt: toCheckOutDateTime(date, draft?.checkInAt, draft?.checkOutAt),
          notes: draft?.notes || undefined,
          source: 'manual',
        };
      });
  }, [rows, draftByEmployeeId, modifiedEmployeeIds, date, isRange]);

  const handleMarkAllPresentByShift = () => {
    const nextDraft = { ...draftByEmployeeId };
    const nextModified = new Set(modifiedEmployeeIds);
    let count = 0;
    for (const row of filteredAttendanceRows) {
      const empId = String(row.employeeId);
      const cur = nextDraft[empId];
      if (!cur?.status || cur.status === 'unmarked') {
        nextDraft[empId] = {
          employeeId: empId,
          status: 'present',
          checkInAt: row.scheduledCheckInTime || '09:00',
          checkOutAt: row.scheduledCheckOutTime || '17:00',
          notes: cur?.notes || '',
        };
        nextModified.add(empId);
        count += 1;
      }
    }
    setDraftByEmployeeId(nextDraft);
    setModifiedEmployeeIds(nextModified);
    toast.success(`تم تسجيل حضور الوردية لـ ${count} موظف. اضغط "حفظ كافة التعديلات" للاعتماد.`);
  };

  const handleSaveAllChanges = async () => {
    if (dirtyRows.length === 0) {
      toast.info('لا توجد تعديلات جديدة للحفظ');
      return;
    }
    try {
      await mutations.saveAttendanceDay.mutateAsync({ workDate: date, rows: dirtyRows });
      setModifiedEmployeeIds(new Set());
      toast.success(`تم حفظ كشف الحضور بنجاح لـ ${dirtyRows.length} موظف`);
    } catch {
      toast.error('تعذر حفظ كشف الحضور');
    }
  };

  const handleExportCsv = () => {
    const rowsToExport = filteredAttendanceRows;
    if (!rowsToExport.length) {
      toast.info('لا توجد سجلات لتصديرها');
      return;
    }
    const headers = [
      'كود الموظف',
      'اسم الموظف',
      'القسم',
      'الوظيفة',
      'التاريخ',
      'اليوم',
      'الوردية المقررة',
      'وقت الحضور',
      'وقت الانصراف',
      'الحالة',
      'ملاحظات',
    ];
    const csvLines = [headers.join(',')];
    for (const r of rowsToExport) {
      const draft = draftByEmployeeId[String(r.employeeId)];
      const cin = draft?.checkInAt || r.checkInAt?.slice(11, 16) || '';
      const cout = draft?.checkOutAt || r.checkOutAt?.slice(11, 16) || '';
      const st = draft?.status || r.status || '';
      const workDateStr = r.workDate || date;
      let dayName = '—';
      try {
        dayName = new Intl.DateTimeFormat('ar-EG', { weekday: 'long' }).format(new Date(workDateStr + 'T12:00:00'));
      } catch {}
      const shift =
        r.scheduledCheckInTime || r.scheduledCheckOutTime
          ? `${r.scheduledCheckInTime || '09:00'} - ${r.scheduledCheckOutTime || '17:00'}`
          : '—';
      const line = [
        `"${r.employeeNo || ''}"`,
        `"${r.employeeName || ''}"`,
        `"${r.departmentName || ''}"`,
        `"${r.jobTitleName || ''}"`,
        `"${workDateStr}"`,
        `"${dayName}"`,
        `"${shift}"`,
        `"${cin}"`,
        `"${cout}"`,
        `"${st}"`,
        `"${(draft?.notes || r.notes || '').replace(/"/g, '""')}"`,
      ];
      csvLines.push(line.join(','));
    }
    const blob = new Blob(['\ufeff' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `كشف_الحضور_${isRange ? `${rangeFrom}_إلى_${rangeTo}` : date}.csv`;
    link.click();
    toast.success('تم تصدير كشف الحضور بنجاح');
  };

  const approveException = async (id: string) => {
    await mutations.approveAttendanceException.mutateAsync({ id, payload: {} });
  };

  const skipException = async (id: string) => {
    await mutations.skipAttendanceException.mutateAsync({ id, payload: {} });
  };

  const submitManualTime = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!manualPrompt || !manualTimeInput) return;
    const { rowId, employeeId, workDate, type } = manualPrompt;
    const payload = {
      employeeId,
      workDate,
      status: 'present',
      notes: manualNoteInput ? manualNoteInput.trim() : undefined,
      ...(type === 'check_in'
        ? { checkInAt: toDateTime(workDate, manualTimeInput) }
        : { checkOutAt: toDateTime(workDate, manualTimeInput) }),
    };
    setManualPrompt(null);
    try {
      await mutations.saveAttendanceRecord.mutateAsync(payload);
      await mutations.skipAttendanceException.mutateAsync({ id: rowId, payload: {} });
      toast.success(type === 'check_in' ? 'تم تسجيل الحضور اليدوي بنجاح' : 'تم تسجيل الانصراف اليدوي بنجاح');
    } catch (err) {
      console.error(err);
      toast.error('حدث خطأ أثناء تسجيل البصمة اليدوية');
    }
  };

  const isSavingBatch = mutations.saveAttendanceDay.isPending;

  return (
    <div className="page-stack page-shell" dir="rtl">
      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #attendance-printable-view, #attendance-printable-view * { visibility: visible !important; }
          #attendance-printable-view {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            background: #ffffff !important;
            padding: 10px !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      <main className="document-prototype-column" style={{ paddingBottom: '20px' }}>
        <PageHeader
          title={t('hr.hr_attendance_page.s0', "الحضور والانصراف")}
          description={t('hr.hr_attendance_page.s1', "تسجيل الحضور اليومي، مراجعة الاستثناءات والتأخير والأوفر تايم في شاشة واحدة.")}
          actions={
            <div className="actions compact-actions no-print">
              <Button
                variant="primary"
                onClick={() => setBiometricModalOpen(true)}
                style={{ backgroundColor: '#170e5e', color: '#ffffff' }}
              >
                {t('hr.hr_attendance_page.biometric_hub', "استيراد الحضور وأجهزة البصمة")}
              </Button>
              {canViewPayroll && <Button variant="secondary" onClick={() => navigate('/hr/payroll')}>{t('hr.hr_attendance_page.s3', "المرتبات")}</Button>}
              {canViewEmployees && <Button variant="secondary" onClick={() => navigate('/hr/employees')}>{t('hr.hr_attendance_page.s4', "الموظفون")}</Button>}
            </div>
          }
        />

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          {/* Unified Anti-Clutter Toolbar */}
          <AttendancePageToolbar
            viewMode={viewMode}
            selectPeriod={selectPeriod}
            stepDay={stepDay}
            date={date}
            setDate={setDate}
            rangeFrom={rangeFrom}
            setRangeFrom={setRangeFrom}
            rangeTo={rangeTo}
            setRangeTo={setRangeTo}
            setViewMode={setViewMode}
            setRangePage={setRangePage}
            selectedEmployeeId={selectedEmployeeId}
            setSelectedEmployeeId={setSelectedEmployeeId}
            activeEmployees={activeEmployees}
            selectedDepartmentId={selectedDepartmentId}
            setSelectedDepartmentId={setSelectedDepartmentId}
            departments={departments}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            summary={summary}
            isRange={isRange}
            handleMarkAllPresentByShift={handleMarkAllPresentByShift}
            handleSaveAllChanges={handleSaveAllChanges}
            isSavingBatch={isSavingBatch}
            dirtyRowsCount={dirtyRows.length}
            handleExportCsv={handleExportCsv}
            exceptionMonth={exceptionMonth}
            setExceptionMonth={setExceptionMonth}
            exceptionFilter={exceptionFilter}
            setExceptionFilter={setExceptionFilter}
            attendanceFilter={attendanceFilter}
            setAttendanceFilter={setAttendanceFilter}
            totalRowsCount={rows.length}
          />

          {/* KPI Summary Banner */}
          <div className="no-print">
            <AttendanceKpiSummary
              summary={summary}
              activeTab={activeTab}
              attendanceFilter={attendanceFilter}
              exceptionFilter={exceptionFilter}
              onSelectAttendanceFilter={(filter) => {
                setActiveTab('attendance');
                setAttendanceFilter(filter);
              }}
              onSelectExceptionFilter={(filter) => {
                setActiveTab('exceptions');
                setExceptionFilter(filter);
              }}
            />
          </div>

          {/* Printable Container */}
          <div id="attendance-printable-view">
            {/* Header only visible when printing */}
            <div
              style={{
                display: 'none',
                marginBottom: '16px',
                borderBottom: '2px solid #0f172a',
                paddingBottom: '8px',
              }}
              className="print-only"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>كشف الحضور والانصراف الرسمي</h2>
                <span style={{ fontSize: '12px', color: '#475569' }}>
                  الفترة: {isRange ? `من ${rangeFrom} إلى ${rangeTo}` : date}
                </span>
              </div>
            </div>

            {/* Employee Period Summary Card */}
            {(isRange || selectedEmployeeId) && activeTab === 'attendance' && (
              <EmployeePeriodSummaryCard
                employee={selectedEmployee as any}
                from={isRange ? rangeFrom : date}
                to={isRange ? rangeTo : date}
                summary={attendance.data?.summary as any}
                rows={filteredAttendanceRows}
              />
            )}

            {/* Active View Table Content */}
            {activeTab === 'attendance' && !validRange ? (
              <p className="error-box">اختر بداية ونهاية صحيحتين لفترة لا تزيد عن 93 يومًا.</p>
            ) : activeTab === 'attendance' ? (
              <QueryFeedback
                isLoading={attendance.isLoading}
                isError={attendance.isError}
                error={attendance.error}
                isEmpty={!filteredAttendanceRows.length}
                loadingText={t('hr.hr_attendance_page.s31', "جاري تحميل سجلات الحضور...")}
                errorTitle={t('hr.hr_attendance_page.s32', "تعذر تحميل سجلات الحضور.")}
                emptyTitle={t('hr.hr_attendance_page.s33', "لا توجد سجلات مطابقة للفلتر الحالي.")}
              >
                {isRange ? (
                  <>
                    <AttendanceRangeTable rows={filteredAttendanceRows} />
                    {Number(attendance.data?.pagination?.totalPages || 1) > 1 && (
                      <div className="actions compact-actions no-print" style={{ marginTop: 12 }}>
                        <Button type="button" variant="secondary" disabled={rangePage <= 1} onClick={() => setRangePage((n) => Math.max(1, n - 1))}>
                          السابق
                        </Button>
                        <span>
                          صفحة {rangePage} من {attendance.data?.pagination?.totalPages}
                        </span>
                        <Button type="button" variant="secondary" disabled={rangePage >= Number(attendance.data?.pagination?.totalPages || 1)} onClick={() => setRangePage((n) => n + 1)}>
                          التالي
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <DailyAttendanceTable
                    rows={filteredAttendanceRows}
                    draftByEmployeeId={draftByEmployeeId}
                    modifiedEmployeeIds={modifiedEmployeeIds}
                    onUpdateDraft={updateDraft}
                    onSaveRow={saveRow}
                    serverTime={attendance.data?.serverTime}
                    serverTimezone={attendance.data?.serverTimezone}
                  />
                )}
              </QueryFeedback>
            ) : (
              <QueryFeedback
                isLoading={exceptions.isLoading}
                isError={exceptions.isError}
                error={exceptions.error}
                isEmpty={!exceptionRows.length}
                loadingText={t('hr.hr_attendance_page.s34', "جاري تحميل الاستثناءات...")}
                errorTitle={t('hr.hr_attendance_page.s35', "تعذر تحميل الاستثناءات.")}
                emptyTitle={t('hr.hr_attendance_page.s36', "لا توجد استثناءات مطابقة لهذا الفلتر.")}
              >
                <AttendanceExceptionsTable
                  rows={exceptionRows}
                  onApprove={approveException}
                  onSkip={skipException}
                  onOpenManualPrompt={(p) => {
                    setManualTimeInput(p?.defaultTime || '09:00');
                    setManualNoteInput('');
                    setManualPrompt(p);
                  }}
                  isApprovePending={mutations.approveAttendanceException.isPending}
                  isSkipPending={mutations.skipAttendanceException.isPending}
                />
              </QueryFeedback>
            )}
          </div>

          <ManualAttendanceModal
            prompt={manualPrompt}
            timeInput={manualTimeInput}
            setTimeInput={setManualTimeInput}
            noteInput={manualNoteInput}
            setNoteInput={setManualNoteInput}
            isPending={mutations.saveAttendanceRecord.isPending}
            onClose={() => setManualPrompt(null)}
            onSubmit={(e) => {
              void submitManualTime(e);
            }}
            serverTime={attendance.data?.serverTime}
            serverTimezone={attendance.data?.serverTimezone}
          />

          <BiometricIntegrationModal
            open={biometricModalOpen}
            onClose={() => setBiometricModalOpen(false)}
            onImported={() => {
              void attendance.refetch();
              void exceptions.refetch();
            }}
          />
        </div>
      </main>
    </div>
  );
}
