import { useTranslation } from 'react-i18next';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { DataTable } from '@/shared/ui/data-table';
import type { HrEmployee, HrLeaveRequest, HrLeaveType } from '@/types/domain';
import { useHrLeaveRequests, useHrLeaveTypes, useHrMutations, useHrWorkspace } from '@/features/hr/hooks/useHr';
import { HrLeavesCreateRequestCard } from '@/features/hr/pages/leaves/HrLeavesCreateRequestCard';
import {
  leaveStatusLabel,
  normalizeArabicDigits,
  normalizeDecimal,
  text,
  toDateOnly,
  todayDate,
} from '@/features/hr/pages/leaves/hr-leaves.helpers';

type LeaveFormState = {
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  daysCount: string;
  reason: string;
  notes: string;
};

type QuickFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'unpaid';

export function HrLeavesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useHrMutations();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('all');
  const [fromDateFilter, setFromDateFilter] = useState('');
  const [toDateFilter, setToDateFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rejectTargetId, setRejectTargetId] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');

  const [leaveForm, setLeaveForm] = useState<LeaveFormState>({
    employeeId: '',
    leaveTypeId: '',
    startDate: todayDate(),
    endDate: todayDate(),
    daysCount: '1',
    reason: '',
    notes: '',
  });

  const workspace = useHrWorkspace({ page: 1, pageSize: 250, search: '' });
  const leaveTypesQuery = useHrLeaveTypes({ page: 1, pageSize: 100, search: '' });
  const leaveRequestsQuery = useHrLeaveRequests({ search, status: statusFilter, page, pageSize });

  const employees = useMemo(() => (workspace.employees.data?.employees || []) as HrEmployee[], [workspace.employees.data?.employees]);
  const leaveTypes = useMemo(() => (leaveTypesQuery.data?.rows || []) as HrLeaveType[], [leaveTypesQuery.data?.rows]);
  const requests = useMemo(() => (leaveRequestsQuery.data?.requests || []) as HrLeaveRequest[], [leaveRequestsQuery.data?.requests]);

  const leaveTypeById = useMemo(() => {
    const map = new Map<string, HrLeaveType>();
    for (const type of leaveTypes) map.set(String(type.id), type);
    return map;
  }, [leaveTypes]);

  const leaveTypeByName = useMemo(() => {
    const map = new Map<string, HrLeaveType>();
    for (const type of leaveTypes) {
      const key = text(type.name).toLowerCase();
      if (key) map.set(key, type);
    }
    return map;
  }, [leaveTypes]);

  const isUnpaidLeave = useCallback((row: HrLeaveRequest) => {
    const byId = leaveTypeById.get(String(row.leaveTypeId || ''));
    const byName = leaveTypeByName.get(text(row.leaveTypeName || row.leaveType).toLowerCase());
    return byId?.isPaid === false || byName?.isPaid === false;
  }, [leaveTypeById, leaveTypeByName]);

  const visibleRequests = useMemo(() => {
    return requests.filter((row) => {
      const leaveTypeId = text(row.leaveTypeId);
      const status = text(row.status);
      if (leaveTypeFilter !== 'all' && leaveTypeId !== leaveTypeFilter) return false;
      if (quickFilter === 'pending' && status !== 'pending') return false;
      if (quickFilter === 'approved' && status !== 'approved') return false;
      if (quickFilter === 'rejected' && status !== 'rejected') return false;
      if (quickFilter === 'unpaid' && !isUnpaidLeave(row)) return false;

      const rowStartDate = toDateOnly(row.startDate);
      const rowEndDate = toDateOnly(row.endDate);
      if (fromDateFilter && rowEndDate && rowEndDate < fromDateFilter) return false;
      if (toDateFilter && rowStartDate && rowStartDate > toDateFilter) return false;
      return true;
    });
  }, [requests, leaveTypeFilter, quickFilter, fromDateFilter, toDateFilter, isUnpaidLeave]);

  const summary = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    let unpaid = 0;

    for (const row of requests) {
      const status = text(row.status);
      if (status === 'pending') pending += 1;
      if (status === 'approved') approved += 1;
      if (status === 'rejected') rejected += 1;
      if (isUnpaidLeave(row)) unpaid += 1;
    }

    return {
      total: requests.length,
      visible: visibleRequests.length,
      pending,
      approved,
      rejected,
      unpaid,
    };
  }, [requests, visibleRequests.length, isUnpaidLeave]);

  const isSearchOrFilterActive = Boolean(search.trim()) || Boolean(statusFilter) || quickFilter !== 'all' || leaveTypeFilter !== 'all' || Boolean(fromDateFilter) || Boolean(toDateFilter);

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('');
    setQuickFilter('all');
    setLeaveTypeFilter('all');
    setFromDateFilter('');
    setToDateFilter('');
    setPage(1);
  };

  const createLeaveRequest = async () => {
    const nextErrors: Record<string, string> = {};
    if (!leaveForm.employeeId) nextErrors.employeeId = 'اختيار الموظف مطلوب.';
    if (!leaveForm.leaveTypeId) nextErrors.leaveTypeId = 'نوع الإجازة مطلوب.';
    if (!leaveForm.startDate) nextErrors.startDate = 'تاريخ البداية مطلوب.';
    if (!leaveForm.endDate) nextErrors.endDate = 'تاريخ النهاية مطلوب.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const selectedType = leaveTypes.find((row) => String(row.id) === leaveForm.leaveTypeId);
    const normalizedDaysCount = normalizeDecimal(leaveForm.daysCount);
    await mutations.createLeaveRequest.mutateAsync({
      employeeId: Number(normalizeArabicDigits(leaveForm.employeeId)),
      leaveTypeId: Number(normalizeArabicDigits(leaveForm.leaveTypeId)),
      leaveType: text(selectedType?.name),
      startDate: toDateOnly(normalizeArabicDigits(leaveForm.startDate)),
      endDate: toDateOnly(normalizeArabicDigits(leaveForm.endDate)),
      daysCount: normalizedDaysCount ? Number(normalizedDaysCount) : undefined,
      reason: text(leaveForm.reason) || undefined,
      notes: text(leaveForm.notes) || undefined,
    });

    setLeaveForm({
      employeeId: '',
      leaveTypeId: '',
      startDate: todayDate(),
      endDate: todayDate(),
      daysCount: '1',
      reason: '',
      notes: '',
    });
    setErrors({});
    setShowCreate(false);
    setQuickFilter('pending');
  };

  const approveRequest = async (id: string) => {
    await mutations.approveLeaveRequest.mutate({ id, payload: {} });
  };

  const rejectRequest = async (id: string) => {
    const reason = text(rejectNotes);
    if (!reason) {
      setErrors((prev) => ({ ...prev, reject: 'سبب الرفض مطلوب.' }));
      return;
    }
    await mutations.rejectLeaveRequest.mutateAsync({ id, payload: { decisionNotes: reason, notes: reason } });
    setRejectTargetId('');
    setRejectNotes('');
    setErrors((prev) => ({ ...prev, reject: '' }));
  };

  const cancelRequest = async (id: string) => {
    await mutations.cancelLeaveRequest.mutate({ id, payload: {} });
  };

  return (
    <div className="page-stack page-shell" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '20px' }}>
        <PageHeader
          title={t('hr.hr_leaves_page.s0', "الإجازات")}
          description={t('hr.hr_leaves_page.s1', "إدارة ومراجعة طلبات الإجازات ومتابعة الإجازات غير المدفوعة المؤثرة على المرتبات.")}
          actions={
            <div className="actions compact-actions">
              <Button type="button" onClick={() => setShowCreate((current) => !current)}>
                {showCreate ? t('hr.hr_leaves_page.s2', "إغلاق النموذج") : t('hr.hr_leaves_page.s3', "+ طلب إجازة")}
              </Button>
              <Button variant="secondary" onClick={() => navigate('/hr/payroll')}>{t('hr.hr_leaves_page.s4', "المرتبات")}</Button>
              <Button variant="secondary" onClick={() => navigate('/hr/employees')}>{t('hr.hr_leaves_page.s5', "الموظفون")}</Button>
            </div>
          }
        />
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>

          {showCreate ? (
            <div style={{ marginBottom: '16px' }}>
              <HrLeavesCreateRequestCard
                leaveForm={leaveForm}
                employees={employees}
                leaveTypes={leaveTypes}
                errors={errors}
                isPending={mutations.createLeaveRequest.isPending}
                onLeaveFormChange={(updater) => setLeaveForm((prev) => updater(prev))}
                onCreate={() => {
                  void createLeaveRequest();
                }}
                onClose={() => {
                  setShowCreate(false);
                  setLeaveForm((prev) => ({ ...prev, startDate: todayDate(), endDate: todayDate() }));
                }}
              />
            </div>
          ) : null}

          {/* Compact Single-Row KPI Summary Bar */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.825rem', fontWeight: 800, color: '#0f172a' }}>{t('hr.hr_leaves_page.s6', "ملخص طلبات الإجازات")}</span>
              <span style={{ fontSize: '0.725rem', color: '#64748b' }}>{t('hr.hr_leaves_page.s7', "اضغط على أي مؤشر لتصفية الطلبات فوراً")}</span>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '8px' }}>
              {[
                { label: t('hr.hr_leaves_page.s8', "إجمالي الطلبات"), value: summary.total, onClick: () => { setQuickFilter('all'); setStatusFilter(''); setPage(1); }, isAlert: false, active: quickFilter === 'all' && !statusFilter },
                { label: t('hr.hr_leaves_page.s9', "قيد المراجعة"), value: summary.pending, onClick: () => { setQuickFilter('pending'); setStatusFilter(''); setPage(1); }, isAlert: summary.pending > 0, active: quickFilter === 'pending' },
                { label: t('hr.hr_leaves_page.s10', "معتمدة"), value: summary.approved, onClick: () => { setQuickFilter('approved'); setStatusFilter(''); setPage(1); }, isAlert: false, active: quickFilter === 'approved' },
                { label: t('hr.hr_leaves_page.s11', "مرفوضة"), value: summary.rejected, onClick: () => { setQuickFilter('rejected'); setStatusFilter(''); setPage(1); }, isAlert: false, active: quickFilter === 'rejected' },
                { label: t('hr.hr_leaves_page.s12', "غير مدفوعة"), value: summary.unpaid, onClick: () => { setQuickFilter('unpaid'); setStatusFilter(''); setPage(1); }, isAlert: false, active: quickFilter === 'unpaid' },
                { label: t('hr.hr_leaves_page.s13', "ظاهر حالياً"), value: summary.visible, onClick: () => {}, isAlert: false, active: false },
              ].map((stat, idx) => (
                <div
                  key={idx}
                  onClick={stat.onClick}
                  style={{
                    background: stat.active ? '#eff6ff' : '#ffffff',
                    border: `1px solid ${stat.active ? '#3b82f6' : stat.isAlert ? '#fca5a5' : '#e2e8f0'}`,
                    borderRadius: '6px',
                    padding: '8px 10px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    transition: 'all 0.15s ease',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                    minWidth: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#94a3b8'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = stat.active ? '#3b82f6' : stat.isAlert ? '#fca5a5' : '#e2e8f0'; }}
                >
                  <span style={{ fontSize: '0.725rem', fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={stat.label}>
                    {stat.label}
                  </span>
                  <strong style={{ fontSize: '1.05rem', fontWeight: 800, color: stat.isAlert ? '#dc2626' : stat.active ? '#1d4ed8' : '#0f172a', lineHeight: 1.2 }}>
                    {stat.value}
                  </strong>
                </div>
              ))}
            </div>
          </div>

          {/* Integrated Toolbar - Single Row */}
          <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '14px', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder={t('hr.hr_leaves_page.s14', "بحث باسم الموظف أو الكود...")}
              style={{ width: '190px', minWidth: '150px', padding: '5px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.825rem', background: '#fff', boxSizing: 'border-box' }}
            />

            <div style={{ width: '160px' }}>
              <CustomSelect
                value={leaveTypeFilter}
                onChange={(val) => { setLeaveTypeFilter(val); setPage(1); }}
                options={[
                  { value: 'all', label: t('hr.hr_leaves_page.s15', "كل أنواع الإجازات") },
                  ...leaveTypes.map((type) => ({ value: String(type.id), label: text(type.name) || '—' })),
                ]}
              />
            </div>


            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>{t('hr.hr_leaves_page.s16', "من:")}</span>
              <input type="date" value={fromDateFilter} onChange={(event) => { setFromDateFilter(normalizeArabicDigits(event.target.value)); setPage(1); }} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem', background: '#fff' }} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>{t('hr.hr_leaves_page.s17', "إلى:")}</span>
              <input type="date" value={toDateFilter} onChange={(event) => { setToDateFilter(normalizeArabicDigits(event.target.value)); setPage(1); }} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem', background: '#fff' }} />
            </div>

            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap', marginRight: 'auto' }}>
              {[
                { label: t('hr.hr_leaves_page.s18', "الكل"), value: 'all' },
                { label: t('hr.hr_leaves_page.s19', "قيد المراجعة"), value: 'pending' },
                { label: t('hr.hr_leaves_page.s20', "معتمدة"), value: 'approved' },
                { label: t('hr.hr_leaves_page.s21', "مرفوضة"), value: 'rejected' },
                { label: t('hr.hr_leaves_page.s22', "غير مدفوعة"), value: 'unpaid' },
              ].map((tab) => (
                <Button
                  key={tab.value}
                  type="button"
                  variant={quickFilter === tab.value ? 'primary' : 'secondary'}
                  onClick={() => { setQuickFilter(tab.value as any); setStatusFilter(''); setPage(1); }}
                  style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                >
                  {tab.label}
                </Button>
              ))}

              {isSearchOrFilterActive && (
                <Button type="button" variant="secondary" onClick={resetFilters} style={{ padding: '4px 8px', fontSize: '0.75rem' }}>
                  {t('hr.hr_leaves_page.s23', "مسح")}
                </Button>
              )}
            </div>
          </div>

          <QueryFeedback
            isLoading={leaveRequestsQuery.isLoading}
            isError={leaveRequestsQuery.isError}
            error={leaveRequestsQuery.error}
            isEmpty={!requests.length || !visibleRequests.length}
            loadingText={t('hr.hr_leaves_page.s24', "جاري تحميل طلبات الإجازة...")}
            errorTitle={t('hr.hr_leaves_page.s25', "تعذر تحميل طلبات الإجازة.")}
            emptyTitle={isSearchOrFilterActive ? t('hr.hr_leaves_page.s26', "لا توجد نتائج مطابقة للفلاتر الحالية.") : t('hr.hr_leaves_page.s27', "لا توجد طلبات إجازة حتى الآن.")}
            emptyHint={isSearchOrFilterActive ? t('hr.hr_leaves_page.s28', "جرّب تعديل الفلاتر أو إزالة البحث.") : t('hr.hr_leaves_page.s29', "ابدأ بإضافة طلب إجازة جديد من الزر أعلى الصفحة.")}
          >
            <DataTable
              rows={visibleRequests}
              rowKey={(row) => String(row.id)}
              density="compact"
              pagination={{
                page,
                pageSize,
                totalItems: visibleRequests.length,
                onPageChange: setPage,
                onPageSizeChange: (next) => {
                  setPageSize(next);
                  setPage(1);
                },
                itemLabel: t('hr.hr_leaves_page.s30', "طلب"),
              }}
              columns={[
                { key: 'employeeNo', header: t('hr.hr_leaves_page.s31', "كود الموظف"), cell: (row) => text(row.employeeNo) || '—' },
                { key: 'employeeName', header: t('hr.hr_leaves_page.s32', "اسم الموظف"), cell: (row) => text(row.employeeName) || '—' },
                { key: 'leaveType', header: t('hr.hr_leaves_page.s33', "نوع الإجازة"), cell: (row) => text(row.leaveTypeName || row.leaveType) || '—' },
                { key: 'startDate', header: t('hr.hr_leaves_page.s34', "من تاريخ"), cell: (row) => toDateOnly(row.startDate) || '—' },
                { key: 'endDate', header: t('hr.hr_leaves_page.s35', "إلى تاريخ"), cell: (row) => toDateOnly(row.endDate) || '—' },
                { key: 'daysCount', header: t('hr.hr_leaves_page.s36', "عدد الأيام"), cell: (row) => Number(row.daysCount || 0).toFixed(2) },
                { key: 'status', header: t('hr.hr_leaves_page.s37', "الحالة"), cell: (row) => leaveStatusLabel(row.status) },
                { key: 'isPaid', header: t('hr.hr_leaves_page.s38', "النوع المالي"), cell: (row) => (!isUnpaidLeave(row) ? t('hr.hr_leaves_page.s39', "مدفوعة") : t('hr.hr_leaves_page.s40', "غير مدفوعة")) },
                { key: 'notes', header: t('hr.hr_leaves_page.s41', "ملاحظات"), cell: (row) => text(row.notes || row.reason || '') || '—' },
                {
                  key: 'actions',
                  header: t('hr.hr_leaves_page.s42', "إجراء"),
                  cell: (row) => {
                    const rowId = String(row.id);
                    const isUnpaid = isUnpaidLeave(row);
                    return (
                      <div className="actions compact-actions">
                        {row.status === 'pending' ? <Button type="button" variant="secondary" onClick={() => void approveRequest(rowId)} disabled={mutations.approveLeaveRequest.isPending} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>{t('hr.hr_leaves_page.s43', "اعتماد")}</Button> : null}
                        {row.status === 'pending' ? <Button type="button" variant="secondary" onClick={() => { setRejectTargetId(rowId); setRejectNotes(''); }} disabled={mutations.rejectLeaveRequest.isPending} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>{t('hr.hr_leaves_page.s44', "رفض")}</Button> : null}
                        {row.status !== 'cancelled' ? <Button type="button" variant="secondary" onClick={() => void cancelRequest(rowId)} disabled={mutations.cancelLeaveRequest.isPending} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>{t('hr.hr_leaves_page.s45', "إلغاء")}</Button> : null}
                        {isUnpaid ? <span className="muted small" style={{ fontSize: '0.7rem' }}>{t('hr.hr_leaves_page.s46', "تؤثر بالمرتب")}</span> : null}
                      </div>
                    );
                  },
                },
              ]}
            />
          </QueryFeedback>

          {rejectTargetId ? (
            <div style={{ marginTop: '16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontWeight: 700, color: '#991b1b', marginBottom: '8px', fontSize: '0.85rem' }}>{t('hr.hr_leaves_page.s47', "سبب رفض طلب الإجازة:")}</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  value={rejectNotes}
                  onChange={(event) => setRejectNotes(event.target.value)}
                  placeholder={t('hr.hr_leaves_page.s48', "اكتب سبب الرفض هنا...")}
                  style={{ flex: 1, padding: '4px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                />
                <Button type="button" onClick={() => void rejectRequest(rejectTargetId)} disabled={mutations.rejectLeaveRequest.isPending} style={{ padding: '4px 12px', fontSize: '0.85rem' }}>
                  {mutations.rejectLeaveRequest.isPending ? t('hr.hr_leaves_page.s49', "جاري الرفض...") : t('hr.hr_leaves_page.s50', "تأكيد الرفض")}
                </Button>
                <Button type="button" variant="secondary" onClick={() => { setRejectTargetId(''); setRejectNotes(''); }} style={{ padding: '4px 12px', fontSize: '0.85rem' }}>{t('hr.hr_leaves_page.s51', "إلغاء")}</Button>
              </div>
              {errors.reject ? <small style={{ color: '#dc2626', display: 'block', marginTop: '4px' }}>{errors.reject}</small> : null}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
