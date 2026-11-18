import { useTranslation } from 'react-i18next';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { getErrorMessage } from '@/lib/errors';
import { hrApi } from '@/features/hr/api/hr.api';
import { useHrMutations } from '@/features/hr/hooks/useHr';
import type { HrAttendanceRecord, HrEmployee } from '@/types/domain';
import { ClockIcon, CheckCircleIcon, MagnifyingGlassIcon } from '@/features/hr/components/HrIcons';
import { todayLocalDateKey } from '@/lib/format';

export const QUICK_ATTENDANCE_SHORTCUT = 'Ctrl + Alt + H';

interface QuickAttendanceShortcutProps {
  open: boolean;
  onClose: () => void;
}

type FilterTab = 'all' | 'unmarked' | 'present' | 'completed';

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function todayDate() {
  return todayLocalDateKey();
}

function formatTimeText(value?: string) {
  if (!value) return '—';
  try {
    const match = String(value).match(/(\d{2}):(\d{2})/);
    if (match) {
      const h = parseInt(match[1], 10);
      const m = match[2];
      const period = h >= 12 ? 'م' : 'ص';
      const h12 = h % 12 || 12;
      return `${String(h12).padStart(2, '0')}:${m} ${period}`;
    }
    return '—';
  } catch {
    return '—';
  }
}

function parseTenantTimeString(str: string): number {
  if (!str) return NaN;
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):?(\d{2})?/);
  if (!match) return NaN;
  return Date.UTC(
    parseInt(match[1], 10),
    parseInt(match[2], 10) - 1,
    parseInt(match[3], 10),
    parseInt(match[4], 10),
    parseInt(match[5], 10),
    parseInt(match[6] || '0', 10)
  );
}

function getTenantNowEpoch(nowDate: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(nowDate);

    const map: Record<string, string> = {};
    for (const p of parts) {
      map[p.type] = p.value;
    }
    const h = parseInt(map.hour, 10) % 24;
    return Date.UTC(
      parseInt(map.year, 10),
      parseInt(map.month, 10) - 1,
      parseInt(map.day, 10),
      h,
      parseInt(map.minute, 10),
      parseInt(map.second, 10)
    );
  } catch {
    return nowDate.getTime();
  }
}

export function QuickAttendanceShortcut({ open, onClose }: QuickAttendanceShortcutProps) {
  const { t } = useTranslation();
  const mutations = useHrMutations();
  const [shortcutOpen, setShortcutOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setShortcutOpen(true);
    }
  }, [open]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const serverAnchorRef = useRef<{ serverEpochMs: number; perfStart: number } | null>(null);

  // Live timer tick anchored to monotonic clock - immune to client OS clock manipulation
  useEffect(() => {
    if (!shortcutOpen) return;
    const timer = setInterval(() => {
      if (serverAnchorRef.current) {
        const elapsed = performance.now() - serverAnchorRef.current.perfStart;
        setNow(new Date(serverAnchorRef.current.serverEpochMs + elapsed));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [shortcutOpen]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return;
      if (event.code !== 'KeyH' && event.key.toLowerCase() !== 'h') return;
      event.preventDefault();
      setShortcutOpen(true);
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  function handleClose() {
    setShortcutOpen(false);
    setSearch('');
    setSelectedEmployeeId('');
    setFeedback(null);
    onClose();
  }

  const employeesQuery = useQuery({
    queryKey: ['hr', 'quick-attendance', 'employees'],
    queryFn: () => hrApi.employees({ page: 1, pageSize: 1000 }),
    enabled: shortcutOpen,
    staleTime: 30_000,
  });

  const attendanceQuery = useQuery({
    queryKey: ['hr', 'quick-attendance', 'today'],
    queryFn: () => hrApi.attendance({ page: 1, pageSize: 1000 }),
    enabled: shortcutOpen,
    staleTime: 10_000,
  });

  const tenantTimezone = attendanceQuery.data?.serverTimezone || 'Africa/Cairo';

  // Synchronize server time anchor whenever attendanceQuery resolves
  useEffect(() => {
    if (attendanceQuery.data?.serverTime) {
      const serverEpoch = new Date(attendanceQuery.data.serverTime).getTime();
      if (!Number.isNaN(serverEpoch)) {
        serverAnchorRef.current = {
          serverEpochMs: serverEpoch,
          perfStart: performance.now(),
        };
        setNow(new Date(serverEpoch));
      }
    }
  }, [attendanceQuery.data?.serverTime]);

  const employees = useMemo(() => (employeesQuery.data?.employees || []) as HrEmployee[], [employeesQuery.data?.employees]);
  const attendanceRows = useMemo(() => (attendanceQuery.data?.rows || []) as HrAttendanceRecord[], [attendanceQuery.data?.rows]);

  const attendanceMap = useMemo(() => {
    const map = new Map<string, HrAttendanceRecord>();
    for (const row of attendanceRows) {
      map.set(String(row.employeeId), row);
    }
    return map;
  }, [attendanceRows]);

  const filteredEmployees = useMemo(() => {
    const term = normalize(search);
    let list = employees;

    if (term) {
      list = list.filter((employee) => {
        const haystack = [employee.employeeNo, employee.displayName, employee.firstName, employee.lastName, employee.departmentName, employee.jobTitleName].map(normalize).join(' ');
        return haystack.includes(term);
      });
    }

    if (activeTab === 'unmarked') {
      list = list.filter((e) => !attendanceMap.get(String(e.id))?.checkInAt);
    } else if (activeTab === 'present') {
      list = list.filter((e) => {
        const att = attendanceMap.get(String(e.id));
        return att?.checkInAt && !att?.checkOutAt;
      });
    } else if (activeTab === 'completed') {
      list = list.filter((e) => {
        const att = attendanceMap.get(String(e.id));
        return att?.checkInAt && att?.checkOutAt;
      });
    }

    return list;
  }, [employees, search, activeTab, attendanceMap]);

  // Auto-select first matching employee if current selection is invalid
  useEffect(() => {
    if (filteredEmployees.length > 0 && (!selectedEmployeeId || !filteredEmployees.some(e => String(e.id) === selectedEmployeeId))) {
      setSelectedEmployeeId(String(filteredEmployees[0].id));
    } else if (filteredEmployees.length === 0) {
      setSelectedEmployeeId('');
    }
  }, [filteredEmployees, selectedEmployeeId]);

  const selectedEmployee = employees.find((row) => String(row.id) === selectedEmployeeId);
  const selectedAttendance = selectedEmployee ? attendanceMap.get(String(selectedEmployee.id)) : undefined;
  const hasCheckIn = Boolean(String(selectedAttendance?.checkInAt || '').trim());
  const hasCheckOut = Boolean(String(selectedAttendance?.checkOutAt || '').trim());

  function calculateWorkedTime(checkIn?: string, checkOut?: string) {
    if (!checkIn) return null;
    const start = parseTenantTimeString(checkIn);
    const end = checkOut
      ? parseTenantTimeString(checkOut)
      : (now ? getTenantNowEpoch(now, tenantTimezone) : NaN);
    if (isNaN(start) || isNaN(end) || end < start) return null;
    const diffMinutes = Math.floor((end - start) / 60000);
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    if (hours === 0) return `${mins} دقيقة`;
    return `${hours} ساعة و ${mins} دقيقة`;
  }

  async function handlePrimaryAction() {
    if (!selectedEmployee) return;
    setFeedback(null);
    const current = attendanceMap.get(String(selectedEmployee.id));
    const checkIn = String(current?.checkInAt || '').trim();
    const checkOut = String(current?.checkOutAt || '').trim();

    try {
      if (!checkIn) {
        await mutations.saveAttendanceRecord.mutateAsync({
          employeeId: Number(selectedEmployee.id),
          punchAction: 'check_in',
          useServerTime: true,
          status: 'present',
          source: 'manual',
        });
        setFeedback({ type: 'success', message: `تم تسجيل حضور "${selectedEmployee.displayName || selectedEmployee.firstName}" بنجاح (وفق توقيت السيرفر المعتمد)` });
        await attendanceQuery.refetch();
        return;
      }
      if (!checkOut) {
        await mutations.saveAttendanceRecord.mutateAsync({
          employeeId: Number(selectedEmployee.id),
          punchAction: 'check_out',
          useServerTime: true,
          status: String(current?.status || 'present'),
          source: 'manual',
        });
        setFeedback({ type: 'success', message: `تم تسجيل انصراف "${selectedEmployee.displayName || selectedEmployee.firstName}" بنجاح (وفق توقيت السيرفر المعتمد)` });
        await attendanceQuery.refetch();
      }
    } catch (err) {
      setFeedback({ type: 'error', message: getErrorMessage(err, 'تعذر تسجيل الحضور أو الانصراف. يرجى المحاولة مرة أخرى.') });
    }
  }

  async function handleStartNewSession() {
    if (!selectedEmployee) return;
    setFeedback(null);
    try {
      await mutations.saveAttendanceRecord.mutateAsync({
        employeeId: Number(selectedEmployee.id),
        useServerTime: true,
        punchAction: 'check_in',
        status: 'present',
        source: 'manual',
        mode: 'new_session',
        allowRecheckin: true,
      });
      setFeedback({
        type: 'success',
        message: `تم بدء وردية / جلسة جديدة للموظف "${selectedEmployee.displayName || selectedEmployee.firstName}" بنجاح (وفق توقيت السيرفر المعتمد)`,
      });
      await attendanceQuery.refetch();
    } catch (err) {
      setFeedback({ type: 'error', message: getErrorMessage(err, 'تعذر بدء وردية جديدة.') });
    }
  }

  async function handleCancelCheckout() {
    if (!selectedEmployee) return;
    setFeedback(null);
    try {
      await mutations.saveAttendanceRecord.mutateAsync({
        employeeId: Number(selectedEmployee.id),
        workDate: attendanceQuery.data?.workDate || todayDate(),
        status: 'present',
        source: 'manual',
        mode: 'cancel_checkout',
      });
      setFeedback({
        type: 'success',
        message: `تم التراجع عن انصراف "${selectedEmployee.displayName || selectedEmployee.firstName}" واستئناف دوام اليوم.`,
      });
      await attendanceQuery.refetch();
    } catch (err) {
      setFeedback({ type: 'error', message: getErrorMessage(err, 'تعذر التراجع عن الانصراف.') });
    }
  }

  const timeFormatted = useMemo(() => {
    if (!now) return 'جارٍ المزامنة...';
    try {
      return now.toLocaleTimeString('ar-EG', {
        timeZone: tenantTimezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    } catch {
      return now.toLocaleTimeString('ar-EG', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    }
  }, [now, tenantTimezone]);

  const dateFormatted = useMemo(() => {
    if (!now) return '—';
    try {
      return now.toLocaleDateString('ar-EG', {
        timeZone: tenantTimezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return now.toLocaleDateString('ar-EG', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
  }, [now, tenantTimezone]);

  const topQuickEmployees = useMemo(() => employees.slice(0, 6), [employees]);
  const workedDuration = calculateWorkedTime(selectedAttendance?.checkInAt, selectedAttendance?.checkOutAt);

  return (
    <DialogShell open={shortcutOpen} onClose={handleClose} width="min(880px, calc(100vw - 40px))" ariaLabel={t('shared.layout.quick_attendance_shortcut.s0', "تسجيل حضور أو انصراف سريع")}>
      <div
        dir="rtl"
        style={{
          boxSizing: 'border-box',
          padding: '24px 28px',
          display: 'flex',
          flexDirection: 'column',
          minHeight: '520px',
          gap: '16px',
          background: '#ffffff',
        }}
      >
        {/* Header Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: '#0f172a', letterSpacing: '-0.2px' }}>
              {t('shared.layout.quick_attendance_shortcut.s1', "نافذة تسجيل الحضور والانصراف السريع")}
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
              {t('shared.layout.quick_attendance_shortcut.s2', "تسجيل الحضور والانصراف والورديات المتعددة ومتابعة ساعات العمل اللحظية.")}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Live Clock Pill - Server Time Synced */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: '#0f172a',
                color: '#ffffff',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '0.84rem',
                fontWeight: 700,
                fontFamily: 'monospace',
                boxShadow: '0 2px 4px rgba(15, 23, 42, 0.15)',
              }}
              title={`توقيت السيرفر المعتمد (${tenantTimezone}) - محمي ضد تغيير ساعة الجهاز`}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: serverAnchorRef.current ? '#22c55e' : '#f59e0b',
                  display: 'inline-block',
                  boxShadow: serverAnchorRef.current ? '0 0 6px #22c55e' : 'none',
                }}
              />
              <span>{timeFormatted}</span>
              <span
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  borderRadius: '4px',
                  padding: '1px 6px',
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  fontFamily: 'system-ui, sans-serif',
                  color: '#cbd5e1',
                }}
              >
                {t('shared.layout.quick_attendance_shortcut.s3', "توقيت السيرفر")}
              </span>
            </div>

            <span style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '4px 10px', fontSize: '0.74rem', fontWeight: 600, color: '#475569' }}>
              {QUICK_ATTENDANCE_SHORTCUT}
            </span>
          </div>
        </div>

        {/* Quick Filter Segment Tabs */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', background: '#f8fafc', padding: '4px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          {[
            { id: 'all', label: `كل الموظفين (${employees.length})` },
            { id: 'unmarked', label: `لم يسجل اليوم (${employees.filter(e => !attendanceMap.get(String(e.id))?.checkInAt).length})` },
            { id: 'present', label: `حاضر الآن (${employees.filter(e => { const a = attendanceMap.get(String(e.id)); return a?.checkInAt && !a?.checkOutAt; }).length})` },
            { id: 'completed', label: `اكتمل (${employees.filter(e => { const a = attendanceMap.get(String(e.id)); return a?.checkInAt && a?.checkOutAt; }).length})` },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as FilterTab)}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: isActive ? '#0f172a' : 'transparent',
                  color: isActive ? '#ffffff' : '#64748b',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  transition: 'background-color 0.15s ease, color 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search Combobox & Quick Chips Card */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'inline-flex', alignItems: 'center' }}>
              <MagnifyingGlassIcon size={16} />
            </span>
            <input
              data-autofocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('shared.layout.quick_attendance_shortcut.s4', "اكتب اسم الموظف أو الكود أو القسم للبحث السريع...")}
              style={{
                width: '100%',
                padding: '8px 34px 8px 34px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '0.84rem',
                boxSizing: 'border-box',
                background: '#ffffff',
                outline: 'none',
              }}
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem' }}
              ><XIcon size={15} /></button>
            ) : null}
          </div>

          {topQuickEmployees.length > 0 && !search && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                <ClockIcon size={13} style={{ color: '#475569' }} /> {t('shared.layout.quick_attendance_shortcut.s5', "اختيار سريع:")}
              </span>
              <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', flexWrap: 'nowrap', paddingBottom: '2px', scrollbarWidth: 'none' }}>
                {topQuickEmployees.map((e) => {
                  const isSel = selectedEmployeeId === String(e.id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setSelectedEmployeeId(String(e.id))}
                      style={{
                        padding: '3px 9px',
                        borderRadius: '6px',
                        border: `1px solid ${isSel ? '#0f172a' : '#e2e8f0'}`,
                        background: isSel ? '#0f172a' : '#ffffff',
                        color: isSel ? '#ffffff' : '#334155',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {e.displayName || e.firstName}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              fontSize: '0.8rem',
              fontWeight: 600,
              background: feedback.type === 'success' ? '#ecfdf5' : '#fef2f2',
              color: feedback.type === 'success' ? '#047857' : '#b91c1c',
              border: `1px solid ${feedback.type === 'success' ? '#a7f3d0' : '#fca5a5'}`,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {feedback.type === 'success' ? <CheckCircleIcon size={16} /> : null}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Error state */}
        {employeesQuery.isError || attendanceQuery.isError ? (
          <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '10px', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid #fca5a5' }}>
            {getErrorMessage(employeesQuery.error || attendanceQuery.error, t('shared.layout.quick_attendance_shortcut.s6', "تعذر تحميل بيانات الموظفين."))}
          </div>
        ) : null}

        {/* Center Main Stage (Flex-1) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {selectedEmployee ? (
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Employee Top Profile Row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '42px', height: '42px', borderRadius: '8px', background: '#0f172a', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', fontWeight: 800, flexShrink: 0 }}>
                    {(selectedEmployee.displayName || selectedEmployee.firstName || t('shared.layout.quick_attendance_shortcut.s7', "م")).slice(0, 2)}
                  </div>
                  <div>
                    <h4 style={{ fontSize: '0.98rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                      {selectedEmployee.displayName || `${selectedEmployee.firstName || ''} ${selectedEmployee.lastName || ''}`.trim()}
                    </h4>
                    <span style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '2px', display: 'block' }}>
                      {t('shared.layout.quick_attendance_shortcut.s8', "كود الموظف:")} <strong style={{ color: '#334155' }}>{selectedEmployee.employeeNo || '—'}</strong>
                      {selectedEmployee.departmentName ? ` · ${selectedEmployee.departmentName}` : ''}
                      {selectedEmployee.jobTitleName ? ` · ${selectedEmployee.jobTitleName}` : ''}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '3px 8px', borderRadius: '6px' }}>{dateFormatted}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedEmployeeId('')}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      padding: '3px 8px',
                      fontSize: '0.74rem',
                      fontWeight: 600,
                      color: '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    {t('shared.layout.quick_attendance_shortcut.s9', "ترك الموظف")}
                  </button>
                </div>
              </div>

              {/* 3 KPI Status Boxes */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>{t('shared.layout.quick_attendance_shortcut.s10', "وقت الحضور اليوم")}</span>
                  <strong style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                    {formatTimeText(selectedAttendance?.checkInAt)}
                  </strong>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>{t('shared.layout.quick_attendance_shortcut.s11', "وقت الانصراف اليوم")}</span>
                  <strong style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                    {formatTimeText(selectedAttendance?.checkOutAt)}
                  </strong>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>{t('shared.layout.quick_attendance_shortcut.s12', "حالة الدوام")}</span>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: '0.84rem', fontWeight: 800, color: !hasCheckIn ? '#64748b' : !hasCheckOut ? '#047857' : '#1e40af' }}>
                      {!hasCheckIn ? t('shared.layout.quick_attendance_shortcut.s13', "لم يسجل") : !hasCheckOut ? t('shared.layout.quick_attendance_shortcut.s14', "حاضر بالعمل") : t('shared.layout.quick_attendance_shortcut.s15', "اكتملت الجلسة")}
                    </strong>
                    {workedDuration && (
                      <span style={{ fontSize: '0.7rem', color: '#64748b', background: '#ffffff', padding: '1px 6px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                        {workedDuration}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Notes / Multi-session info if present */}
              {selectedAttendance?.notes && (
                <div style={{ fontSize: '0.72rem', color: '#64748b', background: '#f8fafc', padding: '6px 10px', borderRadius: '6px', border: '1px solid #f1f5f9' }}>
                  {t('shared.layout.quick_attendance_shortcut.s16', "سجل الورديات السابقة:")} <strong style={{ color: '#0f172a' }}>{selectedAttendance.notes}</strong>
                </div>
              )}

              {/* Instant Action Strip */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', display: 'block' }}>
                    {!hasCheckIn
                      ? t('shared.layout.quick_attendance_shortcut.s17', "تسجيل بصمة الحضور الآن")
                      : !hasCheckOut
                      ? t('shared.layout.quick_attendance_shortcut.s18', "تسجيل بصمة الانصراف الآن")
                      : t('shared.layout.quick_attendance_shortcut.s19', "اكتملت الجلسة الحالية")}
                  </span>
                  <small style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    {!hasCheckIn
                      ? t('shared.layout.quick_attendance_shortcut.s20', "سيتم اعتماد الوقت الحالي كبداية الوردية الفعلية.")
                      : !hasCheckOut
                      ? t('shared.layout.quick_attendance_shortcut.s21', "سيتم احتساب ساعات العمل الفعلي حتى هذه اللحظة.")
                      : t('shared.layout.quick_attendance_shortcut.s22', "يمكنك بدء وردية ثانية جديدة للموظف أو التراجع عن الانصراف.")}
                  </small>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {!hasCheckIn ? (
                    <button
                      type="button"
                      onClick={() => { void handlePrimaryAction(); }}
                      disabled={mutations.saveAttendanceRecord.isPending}
                      style={{
                        background: '#16a34a',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '9px 20px',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)',
                      }}
                    >
                      <ClockIcon size={16} />
                      <span>{mutations.saveAttendanceRecord.isPending ? t('shared.layout.quick_attendance_shortcut.s23', "جارٍ الحفظ...") : `تسجيل حضور (${timeFormatted})`}</span>
                    </button>
                  ) : !hasCheckOut ? (
                    <button
                      type="button"
                      onClick={() => { void handlePrimaryAction(); }}
                      disabled={mutations.saveAttendanceRecord.isPending}
                      style={{
                        background: '#dc2626',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '9px 20px',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        boxShadow: '0 2px 6px rgba(220, 38, 38, 0.25)',
                      }}
                    >
                      <ClockIcon size={16} />
                      <span>{mutations.saveAttendanceRecord.isPending ? t('shared.layout.quick_attendance_shortcut.s24', "جارٍ الحفظ...") : `تسجيل انصراف (${timeFormatted})`}</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => { void handleStartNewSession(); }}
                        disabled={mutations.saveAttendanceRecord.isPending}
                        style={{
                          background: '#16a34a',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '9px 18px',
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)',
                        }}
                      >
                        <ClockIcon size={15} />
                        <span>{mutations.saveAttendanceRecord.isPending ? t('shared.layout.quick_attendance_shortcut.s25', "جارٍ الحفظ...") : t('shared.layout.quick_attendance_shortcut.s26', "+ بدء وردية / جلسة جديدة")}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => { void handleCancelCheckout(); }}
                        disabled={mutations.saveAttendanceRecord.isPending}
                        style={{
                          background: '#ffffff',
                          color: '#475569',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          padding: '8px 14px',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {t('shared.layout.quick_attendance_shortcut.s27', "تراجع عن الانصراف")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, border: '1px dashed #cbd5e1', borderRadius: '10px', padding: '36px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: '#f8fafc' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '8px', background: '#0f172a', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
                <ClockIcon size={24} />
              </div>
              <h4 style={{ fontSize: '0.98rem', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>{t('shared.layout.quick_attendance_shortcut.s28', "اختر موظفاً لبدء تسجيل الحضور أو الانصراف")}</h4>
              <p style={{ fontSize: '0.78rem', color: '#64748b', maxWidth: '440px', margin: 0 }}>
                {t('shared.layout.quick_attendance_shortcut.s29', "يمكنك كتابة اسم الموظف أو الكود في مربع البحث بالأعلى، أو التصفية بالضغط على التبويبات لعرض كرت الموظف وتسجيل البصمة فوراً.")}
              </p>
            </div>
          )}
        </div>

        {/* Footer Bar */}
        <div style={{ display: 'flex', justifyContent: 'flex-start', borderTop: '1px solid #f1f5f9', paddingTop: '12px', marginTop: 'auto' }}>
          <Button type="button" variant="secondary" onClick={handleClose} style={{ padding: '5px 16px', fontSize: '0.82rem' }}>
            {t('shared.layout.quick_attendance_shortcut.s30', "إغلاق النافذة")}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

